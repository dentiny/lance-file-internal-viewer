export interface Selection {
  url: string;
  col: string | null;
  page: number | null;
}

export function toQuery({ url, col, page }: Selection): string {
  const params = new URLSearchParams({ url });
  if (col !== null) params.set("col", col);
  if (col !== null && page !== null) params.set("page", String(page));
  return params.toString();
}

export function fromQuery(search: string): Selection | null {
  const params = new URLSearchParams(search);
  const url = params.get("url");
  if (!url) return null;
  const page = params.get("page");
  return { url, col: params.get("col"), page: page !== null && /^\d+$/.test(page) ? Number(page) : null };
}

export function shareUrl(query: string, location: Location): string {
  return `${location.origin}${location.pathname}?${query}`;
}

export function publishQuery(query: string): void {
  history.replaceState(null, "", `?${query}`);
}
