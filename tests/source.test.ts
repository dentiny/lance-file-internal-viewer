import { describe, expect, it } from "vitest";
import { decode } from "../src/lib/lance/protobuf";
import { needsServer, parentUri, rawUrl } from "../src/lib/lance/server";
import { resolveUrl } from "../src/lib/lance/source";
import { fromQuery, toQuery } from "../src/lib/share";

describe("resolveUrl", () => {
  it("turns Hub blob links and hf:// paths into resolve URLs", () => {
    expect(resolveUrl("https://huggingface.co/datasets/a/b/blob/main/data/x.lance")).toBe(
      "https://huggingface.co/datasets/a/b/resolve/main/data/x.lance",
    );
    expect(resolveUrl("hf://datasets/lance-format/mnist-lance/data/test.lance/data/f.lance")).toBe(
      "https://huggingface.co/datasets/lance-format/mnist-lance/resolve/main/data/test.lance/data/f.lance",
    );
    expect(resolveUrl(" https://example.com/f.lance ")).toBe("https://example.com/f.lance");
  });
});

describe("share query", () => {
  it("round-trips the file, region, column and page", () => {
    const selection = {
      url: "s3://bucket/ds.lance/data/f.lance",
      region: "us-ashburn-1",
      col: "points.item.x",
      page: 3,
    };
    expect(fromQuery(toQuery(selection))).toEqual(selection);
  });

  it("ignores a malformed page and a page without a column", () => {
    expect(fromQuery("?url=x.lance&col=a&page=abc")).toEqual({ url: "x.lance", region: null, col: "a", page: null });
    expect(toQuery({ url: "x.lance", region: null, col: null, page: 2 })).toBe("url=x.lance");
    expect(fromQuery("?page=1")).toBeNull();
  });
});

describe("server locations", () => {
  const nfs = { nfs_roots: [{ logical: "/mnt/shared" }], object_storage_regions: [] };

  it("sends object storage URIs, and absolute paths when the server has NFS roots, to the server", () => {
    expect(needsServer("s3://bucket/f.lance", null)).toBe(true);
    expect(needsServer("oci://bucket/f.lance", null)).toBe(true);
    expect(needsServer("/mnt/shared/f.lance", nfs)).toBe(true);
    expect(needsServer("/sensors.lance", null)).toBe(false);
    expect(needsServer("sensors.lance", nfs)).toBe(false);
    expect(needsServer("https://example.com/f.lance", nfs)).toBe(false);
  });

  it("passes the region only for object storage", () => {
    expect(rawUrl("s3://b/k.lance", "us-phoenix-1")).toBe("api/raw?uri=s3%3A%2F%2Fb%2Fk.lance&region=us-phoenix-1");
    expect(rawUrl("/mnt/shared/k.lance", "us-phoenix-1")).toBe("api/raw?uri=%2Fmnt%2Fshared%2Fk.lance");
  });

  it("walks up to the bucket or filesystem root", () => {
    expect(parentUri("s3://bucket/ds.lance/data/")).toBe("s3://bucket/ds.lance");
    expect(parentUri("s3://bucket/ds.lance")).toBe("s3://bucket");
    expect(parentUri("s3://bucket")).toBeNull();
    expect(parentUri("/mnt/shared/ds.lance")).toBe("/mnt/shared");
    expect(parentUri("/mnt")).toBe("/");
    expect(parentUri("/")).toBeNull();
  });
});

describe("protobuf", () => {
  it("reads negative int32s, packed repeated fields and nested messages", () => {
    // field 4 = -1 (int32 as 10-byte varint), field 1 = packed [1, 300], field 2 = { field 1 = "hi" }
    const bytes = new Uint8Array([
      0x20, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 0x0a, 0x03, 0x01, 0xac, 0x02, 0x12, 0x04, 0x0a,
      0x02, 0x68, 0x69,
    ]);
    const m = decode(bytes);
    expect(m.int32(4)).toBe(-1);
    expect(m.uints(1)).toEqual([1, 300]);
    expect(m.message(2)?.string(1)).toBe("hi");
  });
});
