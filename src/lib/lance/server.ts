/** The optional Rust server (`server/`) that reads S3-compatible object storage and NFS for the browser. */
export interface ServerConfig {
  nfs_roots: { logical: string }[];
  object_storage_regions: string[];
}

export interface Entry {
  name: string;
  uri: string;
  kind: "file" | "directory";
  size: number | null;
}

export interface Listing {
  entries: Entry[];
  truncated: boolean;
}

export function isObjectUri(uri: string): boolean {
  return /^(s3|oci):\/\//.test(uri.trim());
}

/** Locations only the server can read: object storage URIs, and absolute paths when it has NFS roots. */
export function needsServer(uri: string, config: ServerConfig | null): boolean {
  const s = uri.trim();
  return isObjectUri(s) || (s.startsWith("/") && !s.startsWith("//") && !!config?.nfs_roots.length);
}

function query(uri: string, region: string | null): string {
  const params = new URLSearchParams({ uri: uri.trim() });
  if (region && isObjectUri(uri)) params.set("region", region);
  return params.toString();
}

/** A URL that serves the file's bytes with HTTP range support, for `urlSource`. */
export function rawUrl(uri: string, region: string | null): string {
  return `api/raw?${query(uri, region)}`;
}

/** The server's `{ "error": "..." }` message, or the status line. */
export async function responseError(res: Response): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return new Error(body.error);
  } catch {
    // Not a JSON error body.
  }
  return new Error(`${res.status} ${res.statusText || "request failed"}`);
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw await responseError(res);
  return (await res.json()) as T;
}

/** The server's configuration, or null when the page is served without it (e.g. as static files). */
export async function fetchServerConfig(): Promise<ServerConfig | null> {
  try {
    const res = await fetch("api/config");
    if (!res.ok || !res.headers.get("content-type")?.includes("json")) return null;
    return (await res.json()) as ServerConfig;
  } catch {
    return null;
  }
}

export function statLocation(
  uri: string,
  region: string | null,
): Promise<{ kind: Entry["kind"]; size: number | null }> {
  return getJson(`api/stat?${query(uri, region)}`);
}

export function listLocation(uri: string, region: string | null): Promise<Listing> {
  return getJson(`api/list?${query(uri, region)}`);
}

/** The directory containing `uri`, or null at the top of a bucket or filesystem. */
export function parentUri(uri: string): string | null {
  const s = uri.trim().replace(/\/+$/, "");
  const object = s.match(/^((?:s3|oci):\/\/[^/]+)(\/.*)?$/);
  if (object) return object[2] ? s.slice(0, s.lastIndexOf("/")) || null : null;
  const at = s.lastIndexOf("/");
  return at > 0 ? s.slice(0, at) : s === "" || s === "/" ? null : "/";
}
