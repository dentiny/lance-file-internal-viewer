import { decode, type Message } from "./protobuf";
import type { AsyncBuffer } from "./source";

export const FOOTER_BYTES = 40;
const MAGIC = "LANC";

export interface Footer {
  columnMetaStart: number;
  columnMetaTableStart: number;
  globalBufferTableStart: number;
  numGlobalBuffers: number;
  numColumns: number;
  /** The file format version, e.g. "2.1". */
  version: string;
}

export interface BufferRange {
  start: number;
  end: number;
}

/** Where a page or column keeps its encoding description. */
export type EncodingRef =
  | { kind: "direct"; typeUrl: string; value: Uint8Array }
  | { kind: "deferred"; start: number; end: number }
  | { kind: "none" };

export interface PageMeta {
  buffers: BufferRange[];
  /** Rows in the page. */
  length: number;
  /** Top-level row number of the page's first row. */
  priority: number;
  encoding: EncodingRef;
}

export interface ColumnMeta {
  pages: PageMeta[];
  buffers: BufferRange[];
  encoding: EncodingRef;
  /** Where this column's metadata message sits in the file. */
  meta: BufferRange;
}

export interface LanceField {
  id: number;
  name: string;
  logicalType: string;
  nullable: boolean;
  metadata: Record<string, string>;
  children: LanceField[];
}

export interface FileMetadata {
  footer: Footer;
  columns: ColumnMeta[];
  columnMetaTable: BufferRange;
  globalBufferTable: BufferRange;
  globalBuffers: BufferRange[];
  /** Top-level fields; children hang off each field. */
  fields: LanceField[];
  numRows: number;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Parses the last 40 bytes of a file. */
export function parseFooter(bytes: Uint8Array): Footer {
  if (bytes.byteLength !== FOOTER_BYTES) throw new Error("file is shorter than a Lance footer");
  const footer = view(bytes);
  if (new TextDecoder().decode(bytes.subarray(36)) !== MAGIC) throw new Error("no LANC magic at the end of the file");
  const major = footer.getUint16(32, true);
  const minor = footer.getUint16(34, true);
  if (major === 0 && minor < 3) {
    throw new Error(`this is a legacy Lance v0.${minor} file; only the v2 format (2.0 and newer) is supported`);
  }
  return {
    columnMetaStart: Number(footer.getBigUint64(0, true)),
    columnMetaTableStart: Number(footer.getBigUint64(8, true)),
    globalBufferTableStart: Number(footer.getBigUint64(16, true)),
    numGlobalBuffers: footer.getUint32(24, true),
    numColumns: footer.getUint32(28, true),
    // Lance writes 2.0 files with 0.3 in the footer.
    version: major === 0 && minor === 3 ? "2.0" : `${major}.${minor}`,
  };
}

/** Reads the (position, size) pairs of an offset table. */
function offsetTable(bytes: Uint8Array, count: number): BufferRange[] {
  if (bytes.byteLength < count * 16) throw new Error("offset table runs past the footer");
  const table = view(bytes);
  return Array.from({ length: count }, (_, i) => {
    const start = Number(table.getBigUint64(i * 16, true));
    return { start, end: start + Number(table.getBigUint64(i * 16 + 8, true)) };
  });
}

function buffers(message: Message, offsets: number, sizes: number): BufferRange[] {
  const starts = message.uints(offsets);
  const lengths = message.uints(sizes);
  if (starts.length !== lengths.length) throw new Error("buffer offsets and sizes differ in length");
  return starts.map((start, i) => ({ start, end: start + (lengths[i] ?? 0) }));
}

function encodingRef(message: Message | null): EncodingRef {
  if (!message) return { kind: "none" };
  const deferred = message.message(1);
  if (deferred) {
    const start = deferred.uint(1);
    return { kind: "deferred", start, end: start + deferred.uint(2) };
  }
  const direct = message.message(2);
  if (direct) {
    const any = decode(direct.bytes(1));
    return { kind: "direct", typeUrl: any.string(1), value: any.bytes(2) };
  }
  return { kind: "none" };
}

export function parseColumnMeta(bytes: Uint8Array, meta: BufferRange): ColumnMeta {
  const m = decode(bytes);
  return {
    encoding: encodingRef(m.message(1)),
    pages: m.messages(2).map((p) => ({
      buffers: buffers(p, 1, 2),
      length: p.uint(3),
      encoding: encodingRef(p.message(4)),
      priority: p.uint(5),
    })),
    buffers: buffers(m, 3, 4),
    meta,
  };
}

/** The `lance.file.FileDescriptor` in global buffer 0: the schema and row count. */
export function parseFileDescriptor(bytes: Uint8Array): Pick<FileMetadata, "fields" | "numRows"> {
  const descriptor = decode(bytes);
  const schema = descriptor.message(1);
  if (!schema) throw new Error("the file descriptor has no schema");
  // Fields arrive flat, each naming its parent's id; top-level fields have no parent in the list.
  const flat = schema.messages(1).map((f) => {
    const field: LanceField = {
      name: f.string(2),
      id: f.int32(3),
      logicalType: f.string(5),
      nullable: f.bool(6),
      metadata: f.stringMap(10),
      children: [],
    };
    return { parentId: f.int32(4), field };
  });
  const byId = new Map(flat.map(({ field }) => [field.id, field]));
  const fields: LanceField[] = [];
  for (const { parentId, field } of flat) {
    const parent = byId.get(parentId);
    if (parent && parent !== field) parent.children.push(field);
    else fields.push(field);
  }
  return { fields, numRows: descriptor.uint(2) };
}

async function read(file: AsyncBuffer, range: BufferRange): Promise<Uint8Array> {
  if (range.start < 0 || range.end > file.byteLength || range.end < range.start) {
    throw new Error(`byte range ${range.start}-${range.end} is outside the file`);
  }
  return file.slice(range.start, range.end);
}

/** The smallest range covering all of `ranges`. */
function span(ranges: BufferRange[]): BufferRange {
  let start = Infinity;
  let end = -Infinity;
  for (const r of ranges) {
    if (r.start < start) start = r.start;
    if (r.end > end) end = r.end;
  }
  return { start, end };
}

/** Reads the footer, both offset tables, every column's metadata and the schema. */
export async function readMetadata(file: AsyncBuffer): Promise<FileMetadata> {
  const size = file.byteLength;
  if (size < FOOTER_BYTES) throw new Error("file is shorter than a Lance footer");
  const footerStart = size - FOOTER_BYTES;
  const footer = parseFooter(await file.slice(footerStart, size));
  const columnMetaTable = {
    start: footer.columnMetaTableStart,
    end: footer.columnMetaTableStart + footer.numColumns * 16,
  };
  const globalBufferTable = {
    start: footer.globalBufferTableStart,
    end: footer.globalBufferTableStart + footer.numGlobalBuffers * 16,
  };
  if (columnMetaTable.end > footerStart || globalBufferTable.end > footerStart) {
    throw new Error("the footer points past the end of the file");
  }
  const [cmo, gbo] = await Promise.all([read(file, columnMetaTable), read(file, globalBufferTable)]);
  const metaRanges = offsetTable(cmo, footer.numColumns);
  const globalBuffers = offsetTable(gbo, footer.numGlobalBuffers);

  // Column metadatas are written back to back, so one read covers them all; the schema is read alongside.
  const block = span(metaRanges);
  const descriptorRange = globalBuffers[0];
  const [metaBytes, schema] = await Promise.all([
    metaRanges.length ? read(file, block) : null,
    descriptorRange
      ? read(file, descriptorRange).then(parseFileDescriptor)
      : Promise.resolve({ fields: [], numRows: 0 }),
  ]);
  const columns = metaRanges.map((range) =>
    parseColumnMeta((metaBytes as Uint8Array).subarray(range.start - block.start, range.end - block.start), range),
  );
  return { footer, columns, columnMetaTable, globalBufferTable, globalBuffers, ...schema };
}
