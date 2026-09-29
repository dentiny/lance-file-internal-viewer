<script lang="ts">
  import ColumnName from "./ColumnName.svelte";
  import PageRow from "./PageRow.svelte";
  import { columnColor, pieceColor } from "../lib/colors";
  import { formatBytes, formatNumber } from "../lib/format";
  import { getInspector } from "../lib/inspector.svelte";
  import type { Column } from "../lib/lance/model";

  /** Columns with many pages show this many until asked for the rest. */
  const MAX_PAGES = 100;
  /** The size bar is a few hundred pixels wide; past this many pages, seams between them would be sub-pixel. */
  const MAX_SEAMS = 64;

  let { column, maxBytes }: { column: Column; maxBytes: number } = $props();

  const inspector = getInspector();
  const open = $derived(inspector.selectedColumn === column.index);
  const maxPage = $derived(column.pages.reduce((max, p) => Math.max(max, p.bytes), 1));
  let showAll = $state(false);
  const shown = $derived(
    showAll || (inspector.selectedPage ?? 0) >= MAX_PAGES ? column.pages : column.pages.slice(0, MAX_PAGES),
  );

  /** One gradient with a seam per page instead of an element per page, so long columns don't overflow the bar. */
  const gradient = $derived.by(() => {
    const total = column.pages.reduce((sum, p) => sum + p.bytes, 0);
    if (!total) return "none";
    const color = columnColor(column.index, inspector.selectedColumn);
    if (column.pages.length > MAX_SEAMS) return color;
    let at = 0;
    const stops = column.pages.flatMap((p) => {
      const from = (at / total) * 100;
      at += p.bytes;
      const to = (at / total) * 100;
      return [
        `${color} ${from}%`,
        `${color} ${Math.max(from, to - 0.4)}%`,
        `#fff ${Math.max(from, to - 0.4)}%`,
        `#fff ${to}%`,
      ];
    });
    return `linear-gradient(to right, ${stops.join(", ")})`;
  });
</script>

<div class="item" class:open>
  <button type="button" class="summary" aria-expanded={open} onclick={() => inspector.toggleColumn(column.index)}>
    <span class="chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
    <span class="mono muted">{column.index}</span>
    <span class="mono name"><ColumnName name={column.path} /></span>
    <span class="mono r muted">{formatNumber(column.pages.length)}</span>
    <span class="bar"><span style:width="{(column.bytes / maxBytes) * 100}%" style:background={gradient}></span></span>
    <span class="mono r">{formatBytes(column.bytes)}</span>
  </button>
  {#if open}
    <div class="body">
      <div class="meta">
        <span><span class="k">rows</span> <span class="mono">{formatNumber(column.numRows)}</span></span>
        {#if column.field}
          <span><span class="k">type</span> <span class="mono">{column.field.logicalType}</span></span>
        {/if}
        <span>
          <span class="k">metadata</span>
          <span class="mono">{formatNumber(column.meta.start)}–{formatNumber(column.meta.end)}</span>
        </span>
      </div>
      {#each shown as page (page.index)}
        <PageRow {page} {maxPage} />
      {/each}
      {#if shown.length < column.pages.length}
        <button
          type="button"
          class="more"
          onclick={(event) => {
            event.stopPropagation();
            showAll = true;
          }}>Show all {formatNumber(column.pages.length)} pages</button
        >
      {/if}
      {#each column.buffers as buffer (buffer.buffer)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="column-buffer"
          onpointermove={(event) => event.pointerType === "mouse" && inspector.showPopover(buffer, event)}
          onpointerleave={() => inspector.hidePopover()}
        >
          <span class="swatch" style:background={pieceColor(buffer, inspector.selectedColumn)}></span>
          <span>column buffer {buffer.buffer}{buffer.role ? `: ${buffer.role}` : ""}</span>
          <span class="mono r">{formatBytes(buffer.end - buffer.start)}</span>
        </div>
      {/each}
      {#if !column.pages.length && !column.buffers.length}
        <p class="muted empty">No pages or buffers.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .item {
    border-bottom: 1px solid var(--line-soft);
  }

  .item:last-child {
    border: 0;
  }

  .summary {
    display: grid;
    grid-template-columns: var(--col-columns);
    gap: 10px;
    align-items: center;
    width: 100%;
    height: 30px;
    padding: 0 12px;
    border: 0;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .summary:hover {
    background: var(--surface-2);
  }

  .open .summary {
    position: sticky;
    top: 26px;
    z-index: 1;
    background: var(--accent-soft);
  }

  .chevron {
    font-size: 10px;
    color: var(--text-4);
  }

  .name {
    display: flex;
    min-width: 0;
  }

  .r {
    text-align: right;
  }

  .bar {
    height: 8px;
    min-width: 0;
  }

  .bar > span {
    display: block;
    min-width: 2px;
    height: 100%;
    border-radius: 1px;
  }

  .body {
    padding: 8px 12px 12px 36px;
    background: #fcfcfd;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 18px;
    margin-bottom: 6px;
  }

  .k {
    color: var(--text-4);
  }

  .more {
    margin-top: 4px;
    padding: 4px 0;
    border: 0;
    background: none;
    font-size: 12px;
    color: var(--accent);
    cursor: pointer;
  }

  .column-buffer {
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) 64px;
    gap: 8px;
    align-items: center;
    padding: 6px 0;
    border-top: 1px solid #f3f4f6;
    color: var(--text-2);
  }

  .empty {
    margin: 4px 0 0;
  }

  @media (max-width: 700px) {
    .summary {
      gap: 8px;
      padding: 0 10px;
    }
    .bar {
      display: none;
    }
    .body {
      padding: 8px 10px 10px;
    }
  }
</style>
