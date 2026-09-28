import type { Column, LanceModel } from "./model";

export interface Check {
  label: string;
  passed: boolean;
  /** Column paths the check is about: the ones that pass, or for a failed check, the ones at fault. */
  columns: string[];
  /** One sentence on what this means for readers. */
  detail: string;
}

/** The format advises pages of 8 MB or more; below this a column pays a request per small slice of rows. */
export const SMALL_PAGE = 1024 * 1024;
const MAX_DETAIL_NAMES = 8;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Columns split into several pages whose typical (non-final) page is small. */
function smallPageColumns(columns: Column[]): Column[] {
  return columns.filter((c) => c.pages.length > 1 && median(c.pages.slice(0, -1).map((p) => p.bytes)) < SMALL_PAGE);
}

const uses = (c: Column, test: (compression: string[], features: string[]) => boolean) =>
  c.pages.some((p) => test(p.encoding.compression, p.encoding.features));

/** How the file was written, as far as it affects readers: layouts, page sizes, compression and dictionaries. */
export function layoutChecks(model: LanceModel): Check[] {
  const { columns } = model;
  const structural = model.version !== "2.0";
  const small = smallPageColumns(columns).map((c) => c.path);
  const compressed = columns.filter((c) => uses(c, (compression) => compression.length > 0));
  const schemes = [...new Set(compressed.flatMap((c) => c.pages.flatMap((p) => p.encoding.compression)))];
  const dictionary = columns
    .filter((c) => uses(c, (_, features) => features.includes("dictionary")))
    .map((c) => c.path);

  return [
    {
      label: "Structural",
      passed: structural,
      columns: [],
      detail: structural
        ? `Written as ${model.version} with structural layouts: readers fetch the mini-block chunks or values a row needs instead of whole pages.`
        : "Written as 2.0 with the legacy encodings, which often read more of a page than a point lookup needs.",
    },
    {
      label: "Page size",
      passed: small.length === 0,
      columns: small,
      detail: small.length
        ? `${listNames(small)} ${small.length === 1 ? "is" : "are"} split into pages under 1 MB; the format advises 8 MB or more so scans make fewer, larger reads.`
        : "No column is split into pages under 1 MB, so scans make few, large reads.",
    },
    {
      label: "Compressed",
      passed: compressed.length > 0,
      columns: compressed.map((c) => c.path),
      detail: compressed.length
        ? `${listNames(compressed.map((c) => c.path))} ${compressed.length === 1 ? "has" : "have"} pages compressed with ${schemes.join(" and ")}.`
        : "No page uses general-purpose compression (zstd or lz4); values are only lightly encoded.",
    },
    {
      label: "Dictionary",
      passed: dictionary.length > 0,
      columns: dictionary,
      detail: dictionary.length
        ? `${listNames(dictionary)} store${dictionary.length === 1 ? "s" : ""} each distinct value once per page, with small integer indices in the chunks.`
        : "No page is dictionary encoded.",
    },
  ];
}

/** Badge text: the first column plus a count, so files with many matching columns keep a one-line badge. */
export function summarizeNames(names: string[]): string {
  if (names.length <= 2 && names.join(", ").length <= 32) return names.join(", ");
  return `${names[0]} +${names.length - 1}`;
}

function listNames(names: string[]): string {
  if (names.length <= MAX_DETAIL_NAMES) return names.join(", ");
  return `${names.slice(0, MAX_DETAIL_NAMES).join(", ")} and ${(names.length - MAX_DETAIL_NAMES).toLocaleString("en-US")} more`;
}
