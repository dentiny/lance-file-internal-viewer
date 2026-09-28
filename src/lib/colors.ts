import type { Piece } from "./lance/model";
import { KINDS } from "./kinds";

/** Buffers that describe or index the data rather than hold it. */
const SUPPORT = /metadata|index|offsets|repetition|definition|validity/;

/**
 * A distinct muted hue per column: stepping by the golden angle never repeats and keeps neighbours far apart,
 * so files with many columns don't reuse colors. A page's supporting buffers are a lighter tint.
 */
function hueOf(column: number): number {
  return Math.round((215 + column * 137.508) % 360);
}

/** A column's color. With a column selected, the others fade to gray so it stands out in the file map. */
export function columnColor(column: number, selected: number | null, light = false): string {
  const hue = hueOf(column);
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
