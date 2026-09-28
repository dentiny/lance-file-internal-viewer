<script lang="ts">
  import { formatBytes, formatNumber } from "../lib/format";
  import { parentUri, type Listing } from "../lib/lance/server";

  interface Props {
    uri: string;
    region: string | null;
    listing: Listing;
    onopen: (uri: string) => void;
  }

  let { uri, region, listing, onopen }: Props = $props();

  const parent = $derived(parentUri(uri));
  const names = $derived(new Set(listing.entries.map((e) => e.name)));
  /** A dataset root has `_versions/` next to `data/`; its Lance data files are in `data/`. */
  const dataset = $derived(names.has("_versions") && names.has("data"));
  const lanceFiles = $derived(listing.entries.filter((e) => e.kind === "file" && e.name.endsWith(".lance")).length);
</script>

<section class="browser" aria-label="Directory">
  <header>
    <h2 class="mono">{uri}</h2>
    {#if region}<span class="muted mono">{region}</span>{/if}
    <span class="muted">
      {formatNumber(listing.entries.length)}{listing.truncated ? "+" : ""} entries{lanceFiles
        ? ` · ${formatNumber(lanceFiles)} .lance files`
        : ""}
    </span>
  </header>
  {#if dataset}
    <p class="note">
      This is a Lance dataset. Its data files are in
      <button type="button" class="link mono" onclick={() => onopen(`${uri.replace(/\/+$/, "")}/data`)}>data/</button>.
    </p>
  {/if}
  <ul>
    {#if parent}
      <li><button type="button" class="mono" onclick={() => onopen(parent)}>../</button></li>
    {/if}
    {#each listing.entries as entry (entry.uri)}
      <li class:lance={entry.kind === "file" && entry.name.endsWith(".lance")}>
        <button type="button" class="mono" onclick={() => onopen(entry.uri)}>
          {entry.name}{entry.kind === "directory" ? "/" : ""}
        </button>
        {#if entry.size !== null}<span class="size mono">{formatBytes(entry.size)}</span>{/if}
      </li>
    {:else}
      <li class="muted empty">Empty directory.</li>
    {/each}
  </ul>
  {#if listing.truncated}
    <p class="note muted">Only the first {formatNumber(listing.entries.length)} entries are shown.</p>
  {/if}
</section>

<style>
  .browser {
    margin-top: 18px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 12px;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--line);
    background: var(--surface-2);
  }

  h2 {
    margin: 0;
    font-size: 13.5px;
    overflow-wrap: anywhere;
  }

  header span {
    font-size: 12px;
  }

  .note {
    margin: 0;
    padding: 8px 16px;
    border-bottom: 1px solid var(--line-soft);
    font-size: 12.5px;
  }

  ul {
    max-height: 560px;
    margin: 0;
    padding: 4px 0;
    overflow-y: auto;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 16px;
  }

  li:hover {
    background: var(--accent-soft);
  }

  li button {
    min-width: 0;
    height: 26px;
    padding: 0;
    overflow: hidden;
    border: 0;
    background: none;
    font-size: 12.5px;
    color: var(--text-2);
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  li.lance button {
    font-weight: 600;
    color: var(--accent);
  }

  .size {
    flex: none;
    font-size: 11.5px;
    color: var(--text-4);
  }

  .empty {
    height: 30px;
    font-size: 12.5px;
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    font-size: inherit;
    color: var(--accent);
    cursor: pointer;
  }
</style>
