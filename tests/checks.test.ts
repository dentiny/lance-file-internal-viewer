import { describe, expect, it } from "vitest";
import { layoutChecks, summarizeNames } from "../src/lib/lance/checks";
import { describePiece } from "../src/lib/popover";
import { loadFixture } from "./helpers";

describe("sensors.lance", async () => {
  const { model } = await loadFixture("public/sensors.lance");
  const checks = Object.fromEntries(layoutChecks(model).map((c) => [c.label, c]));

  it("finds compression, dictionaries and small pages", () => {
    expect(checks.Structural?.passed).toBe(true);
    expect(checks.Compressed?.columns).toEqual(["temperature"]);
    expect(checks.Dictionary?.columns).toEqual(["sensor_id", "city", "note"]);
    expect(checks["Page size"]?.passed).toBe(false);
  });

  it("labels mini-block buffers and describes them in the popover", () => {
    const page = model.columns.find((c) => c.path === "sensor_id")?.pages[1];
    expect(page?.buffers.map((b) => b.role)).toEqual(["chunk metadata", "chunks", "dictionary"]);
    const chunks = page?.buffers[1];
    if (!chunks) throw new Error("no chunks buffer");
    const content = describePiece(chunks, model);
    expect(content.title).toBe("Page buffer: chunks");
    expect(content.where).toBe("column[2] · page 1 · buffer 1");
    expect(Object.fromEntries(content.rows).Encoding).toBe("mini-block · dictionary · bitpacking");
  });

  it("describes the schema buffer and footer", () => {
    const schema = model.pieces.find((p) => p.kind === "globalBuffer" && p.buffer === 0);
    const footer = model.pieces.find((p) => p.kind === "footer");
    if (!schema || !footer) throw new Error("no schema buffer or footer");
    expect(describePiece(schema, model).title).toBe("Schema (global buffer 0)");
    expect(Object.fromEntries(describePiece(footer, model).rows)).toMatchObject({ Version: "2.1", Columns: "6" });
  });
});

describe("summarizeNames", () => {
  it("keeps short lists whole and collapses long ones to a count", () => {
    expect(summarizeNames(["event_id", "ts"])).toBe("event_id, ts");
    expect(summarizeNames(["sensor_id", "city", "note"])).toBe("sensor_id +2");
  });
});
