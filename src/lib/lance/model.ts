import {
  decodeColumnEncoding,
  decodePageEncoding,
  encodingSummary,
  type ColumnEncoding,
  type PageEncoding,
} from "./encoding";
import { FOOTER_BYTES, type FileMetadata, type Footer, type LanceField } from "./metadata";
import { columnFields } from "./schema";

/** Writers pad every buffer to this many bytes; smaller gaps are padding, larger ones hold unindexed data. */
export const ALIGNMENT = 64;

interface Span {
  start: number;
  end: number;
}

export interface Column {
  index: number;
  path: string;
  field: LanceField | null;
  encoding: ColumnEncoding;
  pages: Page[];
  /** Column-level buffers, e.g. zone maps. */
  buffers: ColumnBufferPiece[];
  meta: Span;
  /** Bytes in this column's page and column buffers. */
  bytes: number;
  numRows: number;
}

export interface Page {
  column: Column;
  index: number;
  firstRow: number;
  numRows: number;
  encoding: PageEncoding;
  buffers: BufferPiece[];
  /** First to last byte of the page's buffers. */
  start: number;
  end: number;
  bytes: number;
}

export interface BufferPiece extends Span {
  kind: "buffer";
  page: Page;
  buffer: number;
  role: string | null;
}
export interface ColumnBufferPiece extends Span {
  kind: "columnBuffer";
  column: Column;
  buffer: number;
  role: string | null;
}
export interface GlobalBufferPiece extends Span {
  kind: "globalBuffer";
  buffer: number;
}
export interface ColumnMetaPiece extends Span {
  kind: "columnMeta";
  column: Column;
}
export interface FilePiece extends Span {
  kind: "columnMetaTable" | "globalBufferTable" | "footer" | "magic" | "gap";
}
/** A whole page as one click target in the file strip. */
export interface PagePiece extends Span {
  kind: "page";
  page: Page;
}

export type Piece = BufferPiece | ColumnBufferPiece | GlobalBufferPiece | ColumnMetaPiece | FilePiece | PagePiece;
export type PieceKind = Piece["kind"];

export interface LanceModel {
  name: string;
  fileSize: number;
  footer: Footer;
  version: string;
  numRows: number;
  fields: LanceField[];
  schemaMetadata: Record<string, string>;
  columns: Column[];
  /** Every page, sorted by where it starts in the file. */
  pages: Page[];
  /** Every byte range we can place, sorted by offset. Pages are not included; their buffers are. */
  pieces: Piece[];
  /** Where the metadata at the end of the file begins. */
  tailStart: number;
  /** Bytes of column metadata, offset tables, the schema buffer and the footer. */
  metadataBytes: number;
  /** Alignment padding between buffers. */
  padding: number;
  /** Things that didn't add up, e.g. a schema that doesn't match the column count. */
  warnings: string[];
}

export function buildModel(name: string, fileSize: number, metadata: FileMetadata): LanceModel {
  const { footer } = metadata;
  const warnings: string[] = [];
  const mapped = columnFields(metadata.fields, footer.version);
  if (mapped.length !== metadata.columns.length) {
    warnings.push(
      `The schema describes ${mapped.length} columns but the file has ${metadata.columns.length}, so column names may be off.`,
    );
  }
  const pieces: Piece[] = [];
  const pages: Page[] = [];

  const columns = metadata.columns.map((meta, index): Column => {
    const encoding = decodeColumnEncoding(meta.encoding);
    const column: Column = {
      index,
      path: mapped[index]?.path ?? `column ${index}`,
      field: mapped[index]?.field ?? null,
      encoding,
      pages: [],
      buffers: [],
      meta: meta.meta,
      bytes: 0,
      numRows: 0,
    };
    const columnRoles = [...encoding.bufferRoles];
    meta.pages.forEach((p, i) => {
      const pageEncoding = decodePageEncoding(p.encoding);
      pageEncoding.columnBufferRoles.forEach((role, b) => (columnRoles[b] ??= role));
      const live = p.buffers.filter((b) => b.end > b.start);
      const page: Page = {
        column,
        index: i,
        firstRow: p.priority,
        numRows: p.length,
        encoding: pageEncoding,
        buffers: [],
        start: live.length ? Math.min(...live.map((b) => b.start)) : 0,
        end: live.length ? Math.max(...live.map((b) => b.end)) : 0,
        bytes: live.reduce((sum, b) => sum + b.end - b.start, 0),
      };
      p.buffers.forEach((b, buffer) => {
        if (b.end <= b.start) return;
        const piece: BufferPiece = {
          kind: "buffer",
          ...b,
          page,
          buffer,
          role: pageEncoding.bufferRoles[buffer] || null,
        };
        page.buffers.push(piece);
        pieces.push(piece);
      });
      column.pages.push(page);
      column.numRows += page.numRows;
      column.bytes += page.bytes;
      if (page.buffers.length) pages.push(page);
    });
    meta.buffers.forEach((b, buffer) => {
      if (b.end <= b.start) return;
      const piece: ColumnBufferPiece = {
        kind: "columnBuffer",
        ...b,
        column,
        buffer,
        role: columnRoles[buffer] ?? null,
      };
      column.buffers.push(piece);
      column.bytes += b.end - b.start;
      pieces.push(piece);
    });
    if (meta.meta.end > meta.meta.start) pieces.push({ kind: "columnMeta", ...meta.meta, column });
    return column;
  });

  metadata.globalBuffers.forEach((b, buffer) => {
    if (b.end > b.start) pieces.push({ kind: "globalBuffer", ...b, buffer });
  });
  const footerStart = fileSize - FOOTER_BYTES;
  for (const [kind, span] of [
    ["columnMetaTable", metadata.columnMetaTable],
    ["globalBufferTable", metadata.globalBufferTable],
    ["footer", { start: footerStart, end: fileSize - 4 }],
    ["magic", { start: fileSize - 4, end: fileSize }],
  ] as const) {
    if (span.end > span.start) pieces.push({ kind, ...span });
  }
  pieces.sort((a, b) => a.start - b.start || a.end - b.end);
  pages.sort((a, b) => a.start - b.start);

  // Fill the holes between known ranges: alignment padding when small, unindexed data (e.g. blob payloads) when not.
  let padding = 0;
  const gaps: FilePiece[] = [];
  let at = 0;
  for (const p of pieces) {
    if (p.start > at) {
      if (p.start - at >= ALIGNMENT) gaps.push({ kind: "gap", start: at, end: p.start });
      else padding += p.start - at;
    }
    at = Math.max(at, p.end);
  }
  const all = [...pieces, ...gaps].sort((a, b) => a.start - b.start || a.end - b.end);

  const descriptor = metadata.globalBuffers[0];
  const tailStart = Math.min(
    footer.columnMetaStart,
    metadata.columnMetaTable.start,
    descriptor && descriptor.end > descriptor.start ? descriptor.start : Infinity,
  );
  const metadataBytes = all
    .filter((p) => p.start >= tailStart && p.kind !== "gap")
    .reduce((sum, p) => sum + p.end - p.start, 0);

  return {
    name,
    fileSize,
    footer,
    version: footer.version,
    numRows: metadata.numRows,
    fields: metadata.fields,
    schemaMetadata: metadata.schemaMetadata,
    columns,
    pages,
    pieces: all,
    tailStart: Math.max(0, Math.min(tailStart, footerStart)),
    metadataBytes,
    padding,
    warnings,
  };
}

/** How many of a column's pages use each encoding summary, most common first. */
export function encodingMix(column: Column): [string, number][] {
  const counts = new Map<string, number>();
  for (const p of column.pages) {
    const key = encodingSummary(p.encoding);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

export function pageTarget(page: Page): PagePiece {
  return { kind: "page", start: page.start, end: page.end, page };
}

export function columnAt(model: LanceModel, index: number): Column {
  const found = model.columns[index];
  if (!found) throw new Error(`no column ${index}`);
  return found;
}
