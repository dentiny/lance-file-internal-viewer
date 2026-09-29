/**
 * A schema-less protobuf reader: enough to walk Lance's metadata messages by field number.
 * Varints stay numbers while they are exact and become bigints past 2^53, so negative int32s survive.
 */
export type Value = number | bigint | Uint8Array;

const utf8 = new TextDecoder();

export class Message {
  constructor(readonly fields: Map<number, Value[]>) {}

  has(field: number): boolean {
    return this.fields.has(field);
  }

  /** The last scalar value of a field, as proto3 merges repeated scalars; 0 when absent. */
  uint(field: number): number {
    const v = this.last(field);
    if (v === undefined) return 0;
    if (v instanceof Uint8Array) throw new Error(`field ${field} is length-delimited, not a number`);
    return Number(v);
  }

  int32(field: number): number {
    const v = this.last(field);
    if (v === undefined) return 0;
    if (v instanceof Uint8Array) throw new Error(`field ${field} is length-delimited, not a number`);
    // Negative int32s are sign-extended to 64 bits on the wire, so only they arrive as bigints.
    return typeof v === "number" ? v | 0 : Number(BigInt.asIntN(32, v));
  }

  bool(field: number): boolean {
    return this.uint(field) !== 0;
  }

  bytes(field: number): Uint8Array {
    const v = this.last(field);
    if (v === undefined) return new Uint8Array();
    if (!(v instanceof Uint8Array)) throw new Error(`field ${field} is a number, not bytes`);
    return v;
  }

  string(field: number): string {
    return utf8.decode(this.bytes(field));
  }

  message(field: number): Message | null {
    return this.has(field) ? decode(this.bytes(field)) : null;
  }

  messages(field: number): Message[] {
    return (this.fields.get(field) ?? []).map((v) => {
      if (!(v instanceof Uint8Array)) throw new Error(`field ${field} is a number, not a message`);
      return decode(v);
    });
  }

  /** A repeated integer field, whether the writer packed it (proto3's default) or not. */
  uints(field: number): number[] {
    const out: number[] = [];
    for (const v of this.fields.get(field) ?? []) {
      if (!(v instanceof Uint8Array)) {
        out.push(Number(v));
        continue;
      }
      const reader = { bytes: v, at: 0 };
      while (reader.at < v.length) out.push(Number(readVarint(reader)));
    }
    return out;
  }

  /** `map<string, bytes>` and `map<string, string>` fields, which are repeated key/value messages. */
  stringMap(field: number): Record<string, string> {
    const out: Record<string, string> = {};
    for (const entry of this.messages(field)) out[entry.string(1)] = entry.string(2);
    return out;
  }

  /** The first of `names` that is set, for `oneof` groups. */
  oneof<T extends string>(names: Record<number, T>): { name: T; field: number } | null {
    for (const key in names) {
      const field = Number(key);
      if (this.fields.has(field)) return { name: names[field] as T, field };
    }
    return null;
  }

  private last(field: number): Value | undefined {
    const values = this.fields.get(field);
    return values?.[values.length - 1];
  }
}

interface Reader {
  bytes: Uint8Array;
  at: number;
}

function readVarint(r: Reader): number | bigint {
  let value = 0;
  let scale = 1;
  for (let i = 0; i < 10; i++) {
    const byte = r.bytes[r.at++];
    if (byte === undefined) throw new Error("truncated protobuf varint");
    value += (byte & 0x7f) * scale;
    if (byte < 0x80) return Number.isSafeInteger(value) ? value : readBigVarint(r, i + 1);
    scale *= 128;
  }
  throw new Error("protobuf varint longer than 10 bytes");
}

/** Re-reads a varint that overflowed 2^53 exactly, by stepping back over its bytes. */
function readBigVarint(r: Reader, length: number): bigint {
  let value = 0n;
  for (let i = 0; i < length; i++) {
    value |= BigInt((r.bytes[r.at - length + i] as number) & 0x7f) << BigInt(7 * i);
  }
  return BigInt.asUintN(64, value);
}

function readFixed(r: Reader, width: 4 | 8): bigint {
  if (r.at + width > r.bytes.length) throw new Error("truncated protobuf fixed-width field");
  const view = new DataView(r.bytes.buffer, r.bytes.byteOffset + r.at, width);
  r.at += width;
  return width === 4 ? BigInt(view.getUint32(0, true)) : view.getBigUint64(0, true);
}

export function decode(bytes: Uint8Array): Message {
  const fields = new Map<number, Value[]>();
  const r: Reader = { bytes, at: 0 };
  while (r.at < bytes.length) {
    const tag = Number(readVarint(r));
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    let value: Value;
    if (wire === 0) value = readVarint(r);
    else if (wire === 1) value = readFixed(r, 8);
    else if (wire === 5) value = readFixed(r, 4);
    else if (wire === 2) {
      const length = Number(readVarint(r));
      if (r.at + length > bytes.length) throw new Error("truncated protobuf message");
      value = bytes.subarray(r.at, r.at + length);
      r.at += length;
    } else {
      throw new Error(`unsupported protobuf wire type ${wire}`);
    }
    if (field === 0) throw new Error("invalid protobuf field number 0");
    const list = fields.get(field);
    if (list) list.push(value);
    else fields.set(field, [value]);
  }
  return new Message(fields);
}
