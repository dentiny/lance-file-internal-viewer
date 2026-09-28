import { describe, expect, it } from "vitest";
import { loadLance } from "../src/lib/lance/load";
import { resolveUrl, urlSource } from "../src/lib/lance/source";

/** Real files on the Hub, read over range requests like the browser does. Run with `REMOTE=1 npm test`. */
const FILES = [
  "hf://datasets/lance-format/mnist-lance/data/test.lance/data/110010001100011101010111b0b1364b67a82b51d912b59a03.lance",
  "hf://datasets/lance-format/fineweb-edu/data/train.lance/data/0002e412-c915-4c70-9100-7c2c3bde614f.lance",
  "hf://datasets/lance-format/laion-1m/data/train.lance/data/0000011100111001110110110bafaa437e8e158f207cad76ec.lance",
];

describe.skipIf(!process.env.REMOTE).each(FILES)("%s", (url) => {
  it("lays out every byte without overlaps and reads only the tail", { timeout: 60_000 }, async () => {
    const { model, counter } = await loadLance(url, () => urlSource(resolveUrl(url)));
    console.log(
      url.split("/").slice(3, 5).join("/"),
      `v${model.version}`,
      `${model.columns.length} columns`,
      `${model.pages.length} pages`,
      `${counter.requests} requests, ${counter.bytes} bytes`,
      model.columns.map((c) => `${c.path}:${c.pages[0]?.encoding.layout}`).join(" "),
      model.warnings,
    );
    expect(model.warnings).toEqual([]);
    for (const [i, piece] of model.pieces.entries()) {
      const next = model.pieces[i + 1];
      if (next) expect(next.start).toBeGreaterThanOrEqual(piece.end);
    }
    expect(model.pieces.reduce((sum, p) => sum + p.end - p.start, 0) + model.padding).toBe(model.fileSize);
    expect(counter.bytes).toBeLessThan(model.fileSize);
  });
});
