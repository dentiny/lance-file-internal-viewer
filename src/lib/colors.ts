import type { Piece } from "./lance/model";
import { KINDS } from "./kinds";

/** Muted hues cycled per column; a page's supporting buffers are a lighter tint of its data buffer. */
const HUES = [215, 28, 150, 330, 262, 45, 180, 0];

/** Buffers that describe or index the data rather than hold it. */
const SUPPORT = /metadata|index|offsets|repetition|definition|validity/;

/** A column's color. With a column selected, the others fade to gray so it stands out in the file map. */
export function columnColor(column: number, selected: number | null, light = false): string {
  const hue = HUES[column % HUES.length];
  if (selected === null) return `hsl(${hue} 45% ${light ? 87 : 74}%)`;
  if (column === selected) return `hsl(${hue} 60% ${light ? 80 : 60}%)`;
  return light ? "#eef0f3" : "#dfe2e6";
}

export function pieceColor(p: Piece, selected: number | null): string {
  if (p.kind === "buffer") return columnColor(p.page.column.index, selected, SUPPORT.test(p.role ?? ""));
  if (p.kind === "page") return columnColor(p.page.column.index, selected);
  if (p.kind === "columnBuffer") return columnColor(p.column.index, selected, true);
  if (p.kind === "globalBuffer" && p.buffer === 0) return "#fbbf24";
  return KINDS[p.kind].color;
}
