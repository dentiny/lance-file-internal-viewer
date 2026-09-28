import { describe, expect, it } from "vitest";
import { columnFields, formatType, schemaLines, type SchemaLine } from "../src/lib/lance/schema";
import { loadFixture } from "./helpers";

const render = (line: SchemaLine) =>
  line.punct === "}"
    ? `${"  ".repeat(line.depth)}}`
    : `${"  ".repeat(line.depth)}${line.depth ? `${line.name}: ${line.type}` : line.name}${line.annotation ? ` ${line.annotation}` : ""}${line.punct === "{" ? " {" : ";"}${line.column === undefined ? "" : ` #${line.column}`}`;

describe("2.1 schema", async () => {
  const { model } = await loadFixture("tests/fixtures/nested-2.1.lance");
  const columns = columnFields(model.fields, model.version);

  it("gives columns only to leaves and folds lists of one leaf into list<type>", () => {
    expect(schemaLines(model.fields, columns).map(render)).toEqual([
      "schema {",
      "  id: int64 not null; #0",
      "  city: string; #1",
      "  tags: list<string>; #2",
      "  point: struct {",
      "    x: int32; #3",
      "    y: int32; #4",
      "  }",
      "  points: list<struct> {",
      "    item: struct {",
      "      x: int32; #5",
      "      y: int32; #6",
      "    }",
      "  }",
      "  vec: fixed_size_list<float32, 4>; #7",
      "  ts: timestamp(ms, UTC); #8",
      "}",
    ]);
  });

  it("names columns by their dotted path", () => {
    expect(model.columns.map((c) => c.path)).toEqual([
      "id",
      "city",
      "tags.item",
      "point.x",
      "point.y",
      "points.item.x",
      "points.item.y",
      // A fixed-size list of primitives is one leaf field, with no `item` child.
      "vec",
      "ts",
    ]);
  });
});

describe("2.0 schema", async () => {
  const { model } = await loadFixture("tests/fixtures/nested-2.0.lance");

  it("gives structs and lists their own columns", () => {
    expect(model.warnings).toEqual([]);
    expect(model.columns.map((c) => c.path)).toEqual([
      "id",
      "city",
      "tags",
      "tags.item",
      "point",
      "point.x",
      "point.y",
      "points",
      "points.item",
      "points.item.x",
      "points.item.y",
      "vec",
      "ts",
    ]);
    const lines = schemaLines(model.fields, columnFields(model.fields, model.version)).map(render);
    expect(lines).toContain("  tags: list { #2");
    expect(lines).toContain("    item: string; #3");
  });
});

describe("formatType", () => {
  it("spells Lance logical types the Arrow way", () => {
    expect(formatType("timestamp:us:-")).toBe("timestamp(us)");
    expect(formatType("timestamp:ns:+05:30")).toBe("timestamp(ns, +05:30)");
    expect(formatType("decimal:128:10:2")).toBe("decimal128(10, 2)");
    expect(formatType("fixed_size_list:lance.bfloat16:8")).toBe("fixed_size_list<lance.bfloat16, 8>");
    expect(formatType("dict:string:int16:false")).toBe("dictionary<int16, string>");
    expect(formatType("large_binary")).toBe("large_binary");
  });
});
