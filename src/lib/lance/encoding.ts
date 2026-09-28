import type { EncodingRef } from "./metadata";
import { decode, type Message } from "./protobuf";

/** One step of an encoding tree, e.g. `bitpacking 64 → 7 bits`, with the encodings it feeds into. */
export interface EncodingNode {
  name: string;
  detail?: string;
  children: { role: string; node: EncodingNode }[];
}

export interface PageEncoding {
  /** The structural layout (2.1+) or top-level array encoding (2.0). */
  layout: string;
  tree: EncodingNode | null;
  /** What each page buffer holds, by index. Missing entries are unknown. */
  bufferRoles: string[];
  /** Roles of the column buffers this page reads, by column buffer index (2.0 only). */
  columnBufferRoles: string[];
  /** General-purpose compression used anywhere in the page, e.g. `zstd`. */
  compression: string[];
  /** Notable encodings used anywhere in the page, e.g. `dictionary`, `fsst`. */
  features: string[];
}

export interface ColumnEncoding {
  name: string;
  tree: EncodingNode | null;
  bufferRoles: string[];
}

const REPDEF_LAYERS = [
  "unspecified",
  "all-valid item",
  "all-valid list",
  "nullable item",
  "nullable list",
  "emptyable list",
  "nullable and emptyable list",
];

const NOISE = new Set(["flat", "variable", "struct", "nullable", "values"]);

function node(name: string, detail?: string, children: [string, EncodingNode | null][] = []): EncodingNode {
  return {
    name,
    detail: detail || undefined,
    children: children.flatMap(([role, n]) => (n ? [{ role, node: n }] : [])),
  };
}

function typeName(typeUrl: string): string {
  return typeUrl.slice(typeUrl.lastIndexOf("/") + 1);
}

/** `u64 → 7 bits` style text for bitpacking. */
function bits(from: number, to?: number): string {
  return to === undefined ? `${from}-bit` : `${from} → ${to} bits`;
}

// ---------------------------------------------------------------- 2.1+ (lance.encodings21)

const SCHEMES = ["default", "lz4", "zstd"];

function bufferCompression(m: Message | null): string | undefined {
  if (!m) return undefined;
  const scheme = SCHEMES[m.uint(1)] ?? `scheme ${m.uint(1)}`;
  return m.has(2) ? `${scheme}(${m.int32(2)})` : scheme;
}

function withCompression(detail: string, compression: string | undefined): string {
  return compression ? `${detail} · ${compression}` : detail;
}

function compressive(m: Message | null): EncodingNode | null {
  if (!m) return null;
  const which = m.oneof({
    1: "flat",
    2: "variable",
    3: "constant",
    4: "bitpacking",
    5: "inline bitpacking",
    6: "fsst",
    7: "dictionary",
    8: "rle",
    9: "byte stream split",
    10: "general",
    11: "fixed-size list",
    12: "packed struct",
    13: "variable packed struct",
  });
  if (!which) return node("unknown");
  const e = m.message(which.field) as Message;
  switch (which.name) {
    case "flat":
      return node("flat", withCompression(bits(e.uint(1)), bufferCompression(e.message(2))));
    case "variable":
      return node("variable", bufferCompression(e.message(2)), [["offsets", compressive(e.message(1))]]);
    case "constant":
      return node("constant", `${e.bytes(1).length} bytes`);
    case "bitpacking":
      return node("bitpacking", bits(e.uint(1)), [["values", compressive(e.message(3))]]);
    case "inline bitpacking":
      return node("inline bitpacking", withCompression(bits(e.uint(1)), bufferCompression(e.message(2))));
    case "fsst":
      return node("fsst", `${e.bytes(1).length} B symbol table`, [["values", compressive(e.message(2))]]);
    case "dictionary":
      return node("dictionary", e.uint(3) ? `${e.uint(3).toLocaleString("en-US")} items` : undefined, [
        ["indices", compressive(e.message(1))],
        ["items", compressive(e.message(2))],
      ]);
    case "rle":
      return node("rle", undefined, [
        ["values", compressive(e.message(1))],
        ["run lengths", compressive(e.message(2))],
      ]);
    case "byte stream split":
      return node("byte stream split", undefined, [["values", compressive(e.message(1))]]);
    case "general":
      return node(bufferCompression(e.message(1)) ?? "general", undefined, [["values", compressive(e.message(3))]]);
    case "fixed-size list":
      return node("fixed-size list", `×${e.uint(1)}${e.bool(3) ? " · nullable" : ""}`, [
        ["values", compressive(e.message(2))],
      ]);
    case "packed struct":
      return node("packed struct", `${e.uints(1).length} fields`, [["values", compressive(e.message(2))]]);
    case "variable packed struct":
      return node(
        "variable packed struct",
        `${e.messages(1).length} fields`,
        e.messages(1).map((f, i) => [`field ${i}`, compressive(f.message(1))]),
      );
  }
}

/** The meaning of each repetition/definition layer, innermost first. */
function layers(m: Message, field: number): string {
  const names = m.uints(field).map((l) => REPDEF_LAYERS[l] ?? `layer ${l}`);
  return names.length ? `repdef ${names.join(", ")}` : "";
}

function pageLayout(m: Message): { layout: string; tree: EncodingNode; roles: string[] } {
  const which = m.oneof({ 1: "mini-block", 2: "constant", 3: "full-zip", 4: "blob", 5: "sparse" });
  if (!which) return { layout: "unknown", tree: node("unknown"), roles: [] };
  const e = m.message(which.field) as Message;
  switch (which.name) {
    case "mini-block": {
      const dictionary = compressive(e.message(4));
      const roles = ["chunk metadata", "chunks"];
      if (dictionary) roles.push("dictionary");
      if (e.uint(8) > 0) roles.push("repetition index");
      const items = e.uint(9);
      return {
        layout: "mini-block",
        roles,
        tree: node(
          "mini-block",
          [items ? `${items.toLocaleString("en-US")} items` : "", layers(e, 6), e.bool(10) ? "large chunks" : ""]
            .filter(Boolean)
            .join(" · "),
          [
            ["values", compressive(e.message(3))],
            ["dictionary", dictionary],
            ["repetition", compressive(e.message(1))],
            ["definition", compressive(e.message(2))],
          ],
        ),
      };
    }
    case "constant": {
      const inline = e.has(6) ? e.bytes(6) : null;
      return {
        layout: inline ? "constant" : "all null",
        roles: ["repetition levels", "definition levels"],
        tree: node(
          inline ? "constant" : "all null",
          [inline ? `${inline.length}-byte value` : "", layers(e, 5)].filter(Boolean).join(" · "),
          [
            ["repetition", compressive(e.message(7))],
            ["definition", compressive(e.message(8))],
          ],
        ),
      };
    }
    case "full-zip": {
      const width = e.has(3) ? `${e.uint(3)}-bit values` : e.has(4) ? `${e.uint(4)}-bit offsets` : "";
      const repdef = [e.uint(1) ? `${e.uint(1)}-bit rep` : "", e.uint(2) ? `${e.uint(2)}-bit def` : ""];
      return {
        layout: "full-zip",
        roles: ["zipped values", "repetition index"],
        tree: node("full-zip", [width, ...repdef, layers(e, 8)].filter(Boolean).join(" · "), [
          ["values", compressive(e.message(7))],
        ]),
      };
    }
    case "blob": {
      const inner = e.message(1);
      const innerLayout = inner ? pageLayout(inner) : null;
      return {
        layout: "blob",
        roles: (innerLayout?.roles ?? []).map((r) => `descriptions: ${r}`),
        tree: node("blob", layers(e, 2), [["descriptions", innerLayout?.tree ?? null]]),
      };
    }
    case "sparse": {
      const structural = e.messages(6).map((l) => {
        const kind = l.oneof({ 1: "validity", 2: "list", 3: "fixed-size list" });
        return kind?.name ?? "layer";
      });
      return {
        layout: "sparse",
        roles: [],
        tree: node(
          "sparse",
          [`${e.uint(4).toLocaleString("en-US")} values`, structural.join(", ")].filter(Boolean).join(" · "),
          [["values", compressive(e.message(1))]],
        ),
      };
    }
  }
}

// ---------------------------------------------------------------- 2.0 (lance.encodings)

const BUFFER_TYPES = ["page", "column", "file"] as const;

interface BufferRefs {
  page: string[];
  column: string[];
}

/** Records that `role` lives in the buffer a `lance.encodings.Buffer` message points at. */
function claim(refs: BufferRefs, buffer: Message | null, role: string): void {
  if (!buffer) return;
  const type = BUFFER_TYPES[buffer.uint(2)];
  if (type === "page" || type === "column") refs[type][buffer.uint(1)] ??= role;
}

function legacyCompression(m: Message | null): string | undefined {
  if (!m) return undefined;
  const scheme = m.string(1);
  return m.has(2) ? `${scheme}(${m.int32(2)})` : scheme;
}

function arrayEncoding(m: Message | null, refs: BufferRefs, role: string): EncodingNode | null {
  if (!m) return null;
  const which = m.oneof({
    1: "flat",
    2: "nullable",
    3: "fixed-size list",
    4: "list",
    5: "struct",
    6: "binary",
    7: "dictionary",
    8: "fsst",
    9: "packed struct",
    10: "bitpacked",
    11: "fixed-size binary",
    12: "bitpacked non-negative",
    13: "constant",
    14: "inline bitpacking",
    15: "bitpacking",
    16: "variable",
    17: "packed struct mini-block",
    18: "block",
    19: "rle",
    20: "general mini-block",
    21: "byte stream split",
  });
  if (!which) return node("unknown");
  const e = m.message(which.field) as Message;
  const child = (field: number, childRole: string) => arrayEncoding(e.message(field), refs, childRole);
  switch (which.name) {
    case "flat":
      claim(refs, e.message(2), role);
      return node("flat", withCompression(bits(e.uint(1)), legacyCompression(e.message(3))));
    case "nullable": {
      const n = e.oneof({ 1: "no nulls", 2: "some nulls", 3: "all null" });
      const inner = n ? (e.message(n.field) as Message) : null;
      if (n?.name === "no nulls" && inner) {
        return node("nullable", "no nulls", [["values", arrayEncoding(inner.message(1), refs, role)]]);
      }
      if (n?.name === "some nulls" && inner) {
        return node("nullable", "some nulls", [
          ["validity", arrayEncoding(inner.message(1), refs, "validity")],
          ["values", arrayEncoding(inner.message(2), refs, role)],
        ]);
      }
      return node("nullable", "all null");
    }
    case "fixed-size list":
      return node("fixed-size list", `×${e.uint(1)}${e.bool(3) ? " · nullable" : ""}`, [["items", child(2, role)]]);
    case "list":
      return node("list", `${e.uint(3).toLocaleString("en-US")} items`, [["offsets", child(1, "list offsets")]]);
    case "struct":
      return node("struct");
    case "binary":
      return node("binary", undefined, [
        ["offsets", child(1, "offsets")],
        ["bytes", child(2, "bytes")],
      ]);
    case "dictionary":
      return node("dictionary", e.uint(3) ? `${e.uint(3).toLocaleString("en-US")} items` : undefined, [
        ["indices", child(1, "dictionary indices")],
        ["items", child(2, "dictionary")],
      ]);
    case "fsst":
      return node("fsst", `${e.bytes(2).length} B symbol table`, [["values", child(1, role)]]);
    case "packed struct":
      claim(refs, e.message(2), role);
      return node(
        "packed struct",
        `${e.messages(1).length} fields`,
        e.messages(1).map((f, i) => [`field ${i}`, arrayEncoding(f, { page: [], column: [] }, role)]),
      );
    case "bitpacked":
      claim(refs, e.message(3), role);
      return node("bitpacked", `${bits(e.uint(2), e.uint(1))}${e.bool(4) ? " · signed" : ""}`);
    case "fixed-size binary":
      return node("fixed-size binary", `${e.uint(2)} bytes`, [["bytes", child(1, role)]]);
    case "bitpacked non-negative":
      claim(refs, e.message(3), role);
      return node("bitpacked", bits(e.uint(2), e.uint(1)));
    case "constant":
      return node("constant", `${e.bytes(1).length} bytes`);
    case "inline bitpacking":
      return node("inline bitpacking", bits(e.uint(2)));
    case "bitpacking":
      return node("bitpacking", bits(e.uint(2), e.uint(3)));
    case "variable":
      return node("variable", `${e.uint(1)}-bit offsets`);
    case "packed struct mini-block":
      return node("packed struct", `${e.uints(2).length} fields`, [["values", child(1, role)]]);
    case "block":
      return node(e.string(1) || "block");
    case "rle":
      return node("rle", bits(e.uint(1)));
    case "general mini-block":
      return node(legacyCompression(e.message(2)) ?? "general", undefined, [["values", child(1, role)]]);
    case "byte stream split":
      return node("byte stream split", bits(e.uint(1)));
  }
}

function columnEncodingNode(m: Message | null, refs: BufferRefs): EncodingNode | null {
  if (!m) return null;
  const which = m.oneof({ 1: "values", 2: "zone map", 3: "blob" });
  const e = which ? m.message(which.field) : null;
  if (which?.name === "zone map" && e) {
    claim(refs, e.message(2), "zone map");
    return node("zone map", `${e.uint(1).toLocaleString("en-US")} rows per zone`, [
      ["inner", columnEncodingNode(e.message(3), refs)],
    ]);
  }
  if (which?.name === "blob" && e) return node("blob", undefined, [["inner", columnEncodingNode(e.message(1), refs)]]);
  return node("values");
}

// ---------------------------------------------------------------- public

function walk(n: EncodingNode | null, visit: (n: EncodingNode) => void): void {
  if (!n) return;
  visit(n);
  for (const c of n.children) walk(c.node, visit);
}

const COMPRESSION = /^(zstd|lz4|gzip|snappy|brotli)\b/;

function facts(tree: EncodingNode | null): { compression: string[]; features: string[] } {
  const compression = new Set<string>();
  const features = new Set<string>();
  walk(tree, (n) => {
    for (const part of [n.name, ...(n.detail?.split(" · ") ?? [])]) {
      const scheme = part.match(COMPRESSION)?.[1];
      if (scheme) compression.add(scheme);
    }
    if (!COMPRESSION.test(n.name) && !NOISE.has(n.name)) features.add(n.name.replace(/^inline /, ""));
    // 2.1+ mini-block pages keep their dictionary beside the values instead of wrapping them.
    if (n.children.some((c) => c.role === "dictionary")) features.add("dictionary");
  });
  return { compression: [...compression], features: [...features] };
}

export function decodePageEncoding(ref: EncodingRef): PageEncoding {
  const empty = { bufferRoles: [], columnBufferRoles: [], compression: [], features: [] };
  if (ref.kind === "none") return { ...empty, layout: "none", tree: null };
  if (ref.kind === "deferred")
    return { ...empty, layout: "deferred", tree: node("deferred", `bytes ${ref.start}–${ref.end}`) };
  const type = typeName(ref.typeUrl);
  const message = decode(ref.value);
  if (type === "lance.encodings21.PageLayout") {
    const { layout, tree, roles } = pageLayout(message);
    return { layout, tree, bufferRoles: roles, columnBufferRoles: [], ...facts(tree) };
  }
  if (type === "lance.encodings.ArrayEncoding") {
    const refs: BufferRefs = { page: [], column: [] };
    const tree = arrayEncoding(message, refs, "values");
    const top = tree?.name === "nullable" && tree.children[0]?.role === "values" ? tree.children[0].node : tree;
    return {
      layout: top?.name ?? "unknown",
      tree,
      bufferRoles: refs.page,
      columnBufferRoles: refs.column,
      ...facts(tree),
    };
  }
  return { ...empty, layout: type || "unknown", tree: node(type || "unknown") };
}

export function decodeColumnEncoding(ref: EncodingRef): ColumnEncoding {
  if (ref.kind !== "direct") return { name: ref.kind, tree: null, bufferRoles: [] };
  const type = typeName(ref.typeUrl);
  if (type !== "lance.encodings.ColumnEncoding") return { name: type, tree: node(type), bufferRoles: [] };
  const refs: BufferRefs = { page: [], column: [] };
  const tree = columnEncodingNode(decode(ref.value), refs);
  return { name: tree?.name ?? "values", tree, bufferRoles: refs.column };
}

/** The encoding tree as indented lines, folding single-child chains into `a → b → c`. */
export function encodingLines(tree: EncodingNode | null): { depth: number; role: string | null; text: string }[] {
  const lines: { depth: number; role: string | null; text: string }[] = [];
  const label = (n: EncodingNode) => (n.detail ? `${n.name} (${n.detail})` : n.name);
  const visit = (n: EncodingNode, depth: number, role: string | null) => {
    const chain = [label(n)];
    let at = n;
    while (at.children.length === 1 && at.children[0]) {
      at = at.children[0].node;
      chain.push(label(at));
    }
    lines.push({ depth, role, text: chain.join(" → ") });
    for (const c of at.children) visit(c.node, depth + 1, c.role);
  };
  if (tree) visit(tree, 0, null);
  return lines;
}

/** A short description like `mini-block · dictionary · zstd` for lists and badges. */
export function encodingSummary(e: PageEncoding): string {
  const parts = [e.layout, ...e.features.filter((f) => f !== e.layout), ...e.compression];
  return [...new Set(parts)].join(" · ");
}
