import type { LanceField } from "./metadata";

const TRUTHY = /^(1|true|on|yes|y)$/i;

export function isBlob(f: LanceField): boolean {
  return "lance-encoding:blob" in f.metadata || f.metadata["ARROW:extension:name"] === "lance.blob.v2";
}

export function isPackedStruct(f: LanceField): boolean {
  return ["packed", "lance-encoding:packed"].some((key) => TRUTHY.test(f.metadata[key] ?? ""));
}

export interface ColumnField {
  field: LanceField;
  /** Dotted path from the top level, e.g. `points.x` or `tags.item`. */
  path: string;
}

/**
 * The field each physical column stores, in column order.
 * 2.0 gives every field a column, structs and lists included; 2.1+ gives columns only to leaves,
 * except that blob and packed-struct fields are one column each.
 */
export function columnFields(fields: LanceField[], version: string): ColumnField[] {
  const legacy = version === "2.0";
  const out: ColumnField[] = [];
  const visit = (f: LanceField, prefix: string) => {
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    const opaque = isBlob(f) || isPackedStruct(f);
    if (legacy || opaque || !f.children.length) out.push({ field: f, path });
    if (!opaque) for (const c of f.children) visit(c, path);
  };
  for (const f of fields) visit(f, "");
  return out;
}

const UNIT = /^(s|ms|us|ns)$/;

/** A Lance logical type in Arrow-style spelling, e.g. `timestamp:us:UTC` → `timestamp(us, UTC)`. */
export function formatType(logicalType: string): string {
  const [head = "", ...rest] = logicalType.split(":");
  switch (head) {
    case "halffloat":
      return "float16";
    case "float":
      return "float32";
    case "double":
      return "float64";
    case "date32":
    case "date64":
      return head;
    case "time32":
    case "time64":
    case "duration":
      return rest[0] && UNIT.test(rest[0]) ? `${head}(${rest[0]})` : logicalType;
    case "timestamp": {
      const [unit, tz = "-"] = [rest[0], rest.slice(1).join(":")];
      return tz && tz !== "-" ? `timestamp(${unit}, ${tz})` : `timestamp(${unit})`;
    }
    case "decimal":
      return `decimal${rest[0]}(${rest[1]}, ${rest[2]})`;
    case "fixed_size_binary":
      return `fixed_size_binary(${rest[0]})`;
    case "fixed_size_list":
      return `fixed_size_list<${formatType(rest.slice(0, -1).join(":"))}, ${rest[rest.length - 1]}>`;
    case "dict":
      return `dictionary<${formatType(rest[1] ?? "")}, ${formatType(rest[0] ?? "")}>`;
    case "list.struct":
      return "list<struct>";
    case "large_list.struct":
      return "large_list<struct>";
    default:
      return logicalType;
  }
}

/** One line of the schema, with list wrappers around a single leaf folded into `list<type>`. */
export interface SchemaLine {
  depth: number;
  name?: string;
  type?: string;
  /** Extra facts shown after the type, e.g. `not null`, `blob`. */
  annotation?: string;
  punct: "{" | ";" | "}";
  /** The physical column this line stands for, if it has one. */
  column?: number;
}

function isListLike(f: LanceField): boolean {
  return /^(large_)?list$|^fixed_size_list:/.test(f.logicalType);
}

function annotations(f: LanceField): string | undefined {
  const notes = [f.nullable ? "" : "not null", isBlob(f) ? "blob" : "", isPackedStruct(f) ? "packed" : ""];
  const text = notes.filter(Boolean).join(", ");
  return text || undefined;
}

export function schemaLines(fields: LanceField[], columns: ColumnField[]): SchemaLine[] {
  const columnOf = new Map(columns.map((c, i) => [c.field, i]));
  const lines: SchemaLine[] = [{ depth: 0, name: "schema", punct: "{" }];
  const visit = (f: LanceField, depth: number) => {
    const [only] = f.children;
    const own = columnOf.get(f);
    const opaque = isBlob(f) || isPackedStruct(f);
    if (!opaque && own === undefined && isListLike(f) && only && f.children.length === 1 && !only.children.length) {
      const type = f.logicalType.startsWith("fixed_size_list")
        ? `fixed_size_list<${formatType(only.logicalType)}, ${f.logicalType.split(":").pop()}>`
        : `${f.logicalType}<${formatType(only.logicalType)}>`;
      lines.push({ depth, name: f.name, type, annotation: annotations(f), punct: ";", column: columnOf.get(only) });
      return;
    }
    const group = f.children.length > 0 && !opaque;
    lines.push({
      depth,
      name: f.name,
      type: formatType(f.logicalType),
      annotation: annotations(f),
      punct: group ? "{" : ";",
      column: own,
    });
    if (!group) return;
    for (const c of f.children) visit(c, depth + 1);
    lines.push({ depth, punct: "}" });
  };
  for (const f of fields) visit(f, 1);
  lines.push({ depth: 0, punct: "}" });
  return lines;
}
