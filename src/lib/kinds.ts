import type { PieceKind } from "./lance/model";

interface KindInfo {
  label: string;
  color: string;
  /** What this byte range is for, in one or two sentences. */
  what: string;
}

export const KINDS: Record<PieceKind, KindInfo> = {
  page: {
    label: "Page",
    color: "#c3c8d0",
    what: "A run of rows of one column. Each column pages on its own, so page boundaries don't line up across columns.",
  },
  buffer: {
    label: "Page buffer",
    color: "#c3c8d0",
    what: "One of the buffers a page's encoding splits its data into. Readers fetch buffers by the offsets in the column metadata.",
  },
  columnBuffer: {
    label: "Column buffer",
    color: "#e2e5ea",
    what: "Data that belongs to the whole column rather than one page, such as a zone map or a shared dictionary.",
  },
  globalBuffer: {
    label: "Global buffer",
    color: "#fcd34d",
    what: "File-wide data referenced from the global buffer table.",
  },
  columnMeta: {
    label: "Column metadata",
    color: "#93c5fd",
    what: "Protobuf ColumnMetadata: every page's buffer offsets, row count and encoding, plus the column's own buffers and encoding.",
  },
  columnMetaTable: {
    label: "Column metadata offsets",
    color: "#d8b4fe",
    what: "16 bytes per column: where its metadata starts and how long it is, so readers can load just the columns they project.",
  },
  globalBufferTable: {
    label: "Global buffer offsets",
    color: "#f0abfc",
    what: "16 bytes per global buffer: its position and size.",
  },
  footer: {
    label: "Footer",
    color: "#4b5563",
    what: "Fixed 36 bytes: offsets of the column metadata and both offset tables, the column and global buffer counts, and the format version.",
  },
  magic: { label: "LANC magic", color: "#111827", what: "4 bytes that end every Lance file." },
  gap: {
    label: "Unindexed bytes",
    color: "#fde68a",
    what: "Bytes no page, column or global buffer points at. Blob columns keep their values here and reference them from page data.",
  },
};

export const SCHEMA_BUFFER_WHAT =
  "Protobuf FileDescriptor: the schema (every field's name, id, parent and logical type, plus metadata) and the row count.";
