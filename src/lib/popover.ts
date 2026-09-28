import { encodingSummary } from "./lance/encoding";
import { formatBytes, formatNumber, percent, rowRange } from "./format";
import { KINDS, SCHEMA_BUFFER_WHAT } from "./kinds";
import type { Column, LanceModel, Page, Piece } from "./lance/model";

export interface PopoverContent {
  title: string;
  /** Column path, for pieces that belong to one column. */
  column: string | null;
  where: string;
  what: string;
  rows: [string, string][];
}

function columnOf(p: Piece): Column | null {
  if (p.kind === "buffer" || p.kind === "page") return p.page.column;
  if (p.kind === "columnBuffer" || p.kind === "columnMeta") return p.column;
  return null;
}

export function pageOf(p: Piece): Page | null {
  return p.kind === "buffer" || p.kind === "page" ? p.page : null;
}

function pageRows(page: Page): [string, string][] {
  return [
    ["Rows", rowRange(page.firstRow, page.numRows)],
    ["Encoding", encodingSummary(page.encoding)],
  ];
}

/** The details shown when hovering or tapping a piece of the file. */
export function describePiece(p: Piece, model: LanceModel): PopoverContent {
  const column = columnOf(p);
  const rows: [string, string][] = [
    ["Bytes", `${formatNumber(p.start)} – ${formatNumber(p.end)}`],
    ["Size", `${formatBytes(p.end - p.start)} · ${percent(p.end - p.start, model.fileSize)} of file`],
  ];
  let title: string = KINDS[p.kind].label;
  let what = KINDS[p.kind].what;

  switch (p.kind) {
    case "buffer":
      title = p.role ? `Page buffer: ${p.role}` : `Page buffer ${p.buffer}`;
      rows.push(...pageRows(p.page), ["Buffer", `${p.buffer + 1} of ${p.page.buffers.length}`]);
      break;
    case "page":
      title = `Page ${p.page.index}`;
      rows.push(...pageRows(p.page), ["Buffers", formatNumber(p.page.buffers.length)]);
      break;
    case "columnBuffer":
      if (p.role) title = `Column buffer: ${p.role}`;
      rows.push(["Encoding", p.column.encoding.name]);
      break;
    case "columnMeta":
      rows.push(
        ["Pages", formatNumber(p.column.pages.length)],
        ["Column buffers", formatNumber(p.column.buffers.length)],
      );
      break;
    case "globalBuffer":
      if (p.buffer === 0) {
        title = "Schema (global buffer 0)";
        what = SCHEMA_BUFFER_WHAT;
        rows.push(["Fields", formatNumber(countFields(model))], ["Rows", formatNumber(model.numRows)]);
      } else {
        title = `Global buffer ${p.buffer}`;
      }
      break;
    case "columnMetaTable":
      rows.push(["Entries", formatNumber(model.columns.length)]);
      break;
    case "globalBufferTable":
      rows.push(["Entries", formatNumber(model.footer.numGlobalBuffers)]);
      break;
    case "footer": {
      const f = model.footer;
      rows.push(
        ["Version", `${f.major}.${f.minor}${f.version !== `${f.major}.${f.minor}` ? ` (Lance ${f.version})` : ""}`],
        ["Columns", formatNumber(f.numColumns)],
        ["Global buffers", formatNumber(f.numGlobalBuffers)],
        ["Metadata at", formatNumber(f.columnMetaStart)],
      );
      break;
    }
    case "magic":
    case "gap":
      break;
    default: {
      const unhandled: never = p;
      throw new Error(`unhandled piece ${JSON.stringify(unhandled)}`);
    }
  }

  return { title, column: column?.path ?? null, where: whereOf(p), what, rows };
}

function countFields(model: LanceModel): number {
  const count = (fields: LanceModel["fields"]): number => fields.reduce((n, f) => n + 1 + count(f.children), 0);
  return count(model.fields);
}

function whereOf(p: Piece): string {
  if (p.kind === "buffer") return `column[${p.page.column.index}] · page ${p.page.index} · buffer ${p.buffer}`;
  if (p.kind === "page") return `column[${p.page.column.index}] · page ${p.page.index}`;
  if (p.kind === "columnBuffer") return `column[${p.column.index}] · column buffer ${p.buffer}`;
  if (p.kind === "columnMeta") return `column[${p.column.index}]`;
  if (p.kind === "globalBuffer") return `global buffer ${p.buffer}`;
  return p.kind === "gap" ? "data area" : "end of file";
}
