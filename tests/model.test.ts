import { describe, expect, it } from "vitest";
import type { EncodingNode } from "../src/lib/lance/encoding";
import { expected, loadFixture } from "./helpers";

/** Rust message names from Lance's Debug output, mapped to the names the decoder gives them. */
const RUST_NAMES: Record<string, string | null> = {
  MiniBlockLayout: "mini-block",
  FullZipLayout: "full-zip",
  ConstantLayout: "constant|all null",
  BlobLayout: "blob",
  Flat: "flat",
  Variable: "variable",
  InlineBitpacking: "inline bitpacking",
  OutOfLineBitpacking: "bitpacking",
  ByteStreamSplit: "byte stream split",
  General: "zstd|lz4",
  Fsst: "fsst",
  Dictionary: "dictionary",
  Rle: "rle",
  FixedSizeList: "fixed-size list",
  List: "list",
  Binary: "binary",
  Struct: "struct",
  Nullable: "nullable",
  // Nullability variants are folded into the nullable node's detail.
  NoNulls: null,
  SomeNulls: null,
  AllNulls: null,
};

function names(tree: EncodingNode | null): string[] {
  if (!tree) return [];
  return [tree.name, ...tree.children.flatMap((c) => names(c.node))];
}

const files = ["nested-2.0.lance", "nested-2.1.lance", "nested-2.2.lance", "sensors.lance"];

describe.each(files)("%s", async (name) => {
  const path = name === "sensors.lance" ? "public/sensors.lance" : `tests/fixtures/${name}`;
  const { model, counter } = await loadFixture(path);
  const want = await expected(name);

  it("reads the metadata from the tail in one request", () => {
    expect(counter.requests).toBe(1);
    expect(`${model.footer.major}.${model.footer.minor}`).toBe(want.version);
    expect(model.version).toBe(want.version === "0.3" ? "2.0" : want.version);
    expect(model.numRows).toBe(want.num_rows);
  });

  it("finds every page buffer, column buffer and global buffer Lance's reader reports", () => {
    expect(model.columns).toHaveLength(want.columns.length);
    model.columns.forEach((column, c) => {
      const pages = want.columns[c]?.pages ?? [];
      expect(column.pages.map((p) => p.buffers.map((b) => [b.start, b.end - b.start]))).toEqual(
        pages.map((p) => p.buffers.filter(([, size]) => size > 0)),
      );
      expect(column.buffers.map((b) => [b.start, b.end - b.start])).toEqual(want.columns[c]?.column_buffers);
    });
    const globals = model.pieces.filter((p) => p.kind === "globalBuffer");
    expect(globals.map((g) => [g.start, g.end - g.start])).toEqual(want.global_buffers);
  });

  it("decodes the same encoding messages Lance's reader prints", () => {
    model.columns.forEach((column, c) => {
      column.pages.forEach((page, p) => {
        const rust = (want.columns[c]?.pages[p]?.encodings ?? []).map((n) => RUST_NAMES[n]).filter((n) => n !== null);
        const ours = names(page.encoding.tree);
        expect(ours.length, `column ${c} page ${p}: ${ours.join(", ")}`).toBeGreaterThanOrEqual(rust.length);
        for (const r of rust) {
          expect(r, `column ${c} page ${p}`).toBeDefined();
          expect(
            ours.some((o) => new RegExp(`^(${r})$`).test(o)),
            `${r} in ${ours.join(", ")}`,
          ).toBe(true);
        }
      });
    });
  });

  it("places every piece inside the file without overlaps", () => {
    for (const [i, piece] of model.pieces.entries()) {
      expect(piece.start).toBeGreaterThanOrEqual(0);
      expect(piece.end).toBeLessThanOrEqual(model.fileSize);
      expect(piece.end).toBeGreaterThan(piece.start);
      const next = model.pieces[i + 1];
      if (next) expect(next.start).toBeGreaterThanOrEqual(piece.end);
    }
    const covered = model.pieces.reduce((sum, p) => sum + p.end - p.start, 0);
    expect(covered + model.padding).toBe(model.fileSize);
  });

  it("covers every row of every column with pages", () => {
    for (const column of model.columns) {
      if (!column.pages.length) continue;
      expect(column.numRows, column.path).toBe(model.numRows);
      column.pages.forEach((page, i) => {
        const prev = column.pages[i - 1];
        expect(page.firstRow).toBe(prev ? prev.firstRow + prev.numRows : 0);
      });
    }
  });
});
