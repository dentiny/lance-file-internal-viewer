export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 100 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatNumber(n: number | bigint): string {
  return n.toLocaleString("en-US");
}

export function percent(part: number, whole: number): string {
  if (!whole) return "0%";
  const v = (part / whole) * 100;
  if (v > 0 && v < 0.01) return "<0.01%";
  return `${v < 0.1 ? v.toFixed(2) : v.toFixed(1)}%`;
}

export function rowRange(firstRow: number, numRows: number): string {
  if (!numRows) return "none";
  return `${formatNumber(firstRow)} – ${formatNumber(firstRow + numRows - 1)}`;
}
