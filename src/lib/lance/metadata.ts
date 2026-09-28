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
  major: number;
  minor: number;
  /** The file version readers use, e.g. "2.1". Lance 2.0 files may say 0.3 in the footer. */
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

export type FieldKind = "parent" | "repeated" | "leaf";

export interface LanceField {
  id: number;
  parentId: number;
  name: string;
  kind: FieldKind;
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
  schemaMetadata: Record<string, string>;
  numRows: number;
}

export function parseFooter(bytes: ArrayBuffer): Footer {
  if (bytes.byteLength < FOOTER_BYTES) throw new Error("file is shorter than a Lance footer");
  const view = new DataView(bytes, bytes.byteLength - FOOTER_BYTES);
  const magic = new TextDecoder().decode(new Uint8Array(bytes, bytes.byteLength - 4));
  if (magic !== MAGIC) throw new Error("no LANC magic at the end of the file");
  const major = view.getUint16(32, true);
  const minor = view.getUint16(34, true);
  if (major === 0 && minor < 3) {
    throw new Error(`this is a legacy Lance v0.${minor} file; only the v2 format (2.0 and newer) is supported`);
  }
  return {
    columnMetaStart: Number(view.getBigUint64(0, true)),
    columnMetaTableStart: Number(view.getBigUint64(8, true)),
    globalBufferTableStart: Number(view.getBigUint64(16, true)),
    numGlobalBuffers: view.getUint32(24, true),
    numColumns: view.getUint32(28, true),
    major,
    minor,
    version: major === 0 && minor === 3 ? "2.0" : `${major}.${minor}`,
  };
}

/** Reads the (position, size) pairs of an offset table. */
function offsetTable(bytes: ArrayBuffer, count: number): BufferRange[] {
  const view = new DataView(bytes);
  if (bytes.byteLength < count * 16) throw new Error("offset table runs past the footer");
  return Array.from({ length: count }, (_, i) => {
    const start = Number(view.getBigUint64(i * 16, true));
    return { start, end: start + Number(view.getBigUint64(i * 16 + 8, true)) };
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

const FIELD_KINDS: FieldKind[] = ["parent", "repeated", "leaf"];

/** The `lance.file.FileDescriptor` in global buffer 0: the schema and row count. */
export function parseFileDescriptor(bytes: Uint8Array): Pick<FileMetadata, "fields" | "schemaMetadata" | "numRows"> {
  const descriptor = decode(bytes);
  const schema = descriptor.message(1);
  if (!schema) throw new Error("the file descriptor has no schema");
  const flat = schema.messages(1).map((f): LanceField => ({
    kind: FIELD_KINDS[f.uint(1)] ?? "leaf",
    name: f.string(2),
    id: f.int32(3),
    parentId: f.int32(4),
    logicalType: f.string(5),
    nullable: f.bool(6),
    metadata: f.stringMap(10),
    children: [],
  }));
  const byId = new Map(flat.map((f) => [f.id, f]));
  const fields: LanceField[] = [];
  for (const field of flat) {
    const parent = byId.get(field.parentId);
    if (parent && parent !== field) parent.children.push(field);
    else fields.push(field);
  }
  return { fields, schemaMetadata: schema.stringMap(5), numRows: descriptor.uint(2) };
}

async function read(file: AsyncBuffer, range: BufferRange): Promise<Uint8Array> {
  if (range.start < 0 || range.end > file.byteLength || range.end < range.start) {
    throw new Error(`byte range ${range.start}-${range.end} is outside the file`);
  }
  return new Uint8Array(await file.slice(range.start, range.end));
}

/** Reads the footer, both offset tables, every column's metadata and the schema. */
export async function readMetadata(file: AsyncBuffer): Promise<FileMetadata> {
  const size = file.byteLength;
  if (size < FOOTER_BYTES) throw new Error("file is shorter than a Lance footer");
  const footer = parseFooter(await file.slice(size - FOOTER_BYTES, size));
  const footerStart = size - FOOTER_BYTES;
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
  const metaRanges = offsetTable(cmo.slice().buffer, footer.numColumns);
  const globalBuffers = offsetTable(gbo.slice().buffer, footer.numGlobalBuffers);

  // Column metadatas are written back to back, so one read covers them all.
  const columns: ColumnMeta[] = [];
  if (metaRanges.length) {
    const block = {
      start: Math.min(...metaRanges.map((r) => r.start)),
      end: Math.max(...metaRanges.map((r) => r.end)),
    };
    const bytes = await read(file, block);
    for (const range of metaRanges) {
      columns.push(parseColumnMeta(bytes.subarray(range.start - block.start, range.end - block.start), range));
    }
  }

  const descriptorRange = globalBuffers[0];
  const schema = descriptorRange
    ? parseFileDescriptor(await read(file, descriptorRange))
    : { fields: [], schemaMetadata: {}, numRows: 0 };
  return { footer, columns, columnMetaTable, globalBufferTable, globalBuffers, ...schema };
}
