export interface Selection {
  url: string;
  /** Object storage region, for `s3://` and `oci://` locations read through the server. */
  region: string | null;
  col: string | null;
  page: number | null;
}

export function toQuery({ url, region, col, page }: Selection): string {
  const params = new URLSearchParams({ url });
  if (region !== null) params.set("region", region);
  if (col !== null) params.set("col", col);
  if (col !== null && page !== null) params.set("page", String(page));
  return params.toString();
}

export function fromQuery(search: string): Selection | null {
  const params = new URLSearchParams(search);
  const url = params.get("url");
  if (!url) return null;
  const page = params.get("page");
  return {
    url,
    region: params.get("region"),
    col: params.get("col"),
    page: page !== null && /^\d+$/.test(page) ? Number(page) : null,
  };
}

export function shareUrl(query: string, location: Location): string {
  return `${location.origin}${location.pathname}?${query}`;
}

export function publishQuery(query: string): void {
  history.replaceState(null, "", `?${query}`);
}
