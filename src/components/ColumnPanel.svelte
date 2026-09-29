<script lang="ts">
  import { columnColor } from "../lib/colors";
  import { formatBytes, formatNumber, percent, rowRange } from "../lib/format";
  import { getInspector } from "../lib/inspector.svelte";
  import { columnAt, encodingMix, type Page } from "../lib/lance/model";

  /** The row lane is a few hundred pixels wide; columns with more pages than this share segments. */
  const MAX_SEGMENTS = 200;

  let { column: index, depth }: { column: number; depth: number } = $props();

  const inspector = getInspector();
  const { model } = inspector;

  const column = $derived(columnAt(model, index));
  const field = $derived(column.field);
  const totalRows = $derived(Math.max(model.numRows, column.numRows, 1));
  const mix = $derived(encodingMix(column));
  const metadata = $derived(Object.entries(field?.metadata ?? {}));
  const metaBytes = $derived(column.meta.end - column.meta.start);

  /** Consecutive pages merged so the lane never has more than MAX_SEGMENTS elements. */
  const segments = $derived.by(() => {
    const per = Math.ceil(column.pages.length / MAX_SEGMENTS);
    const out: { first: Page; last: Page; bytes: number }[] = [];
    for (let i = 0; i < column.pages.length; i += per) {
      const group = column.pages.slice(i, i + per);
      out.push({
        first: group[0] as Page,
        last: group[group.length - 1] as Page,
        bytes: group.reduce((sum, p) => sum + p.bytes, 0),
      });
    }
    return out;
  });

  function describe({ first, last, bytes }: (typeof segments)[number]): string {
    const rows = rowRange(first.firstRow, last.firstRow + last.numRows - first.firstRow);
    const pages = first === last ? `Page ${first.index}` : `Pages ${first.index}–${last.index}`;
    return `${pages}: rows ${rows}, ${formatBytes(bytes)}`;
  }

  function open(event: MouseEvent, page: Page) {
    event.stopPropagation();
    inspector.togglePage(page, { reveal: true, inPage: true });
  }
</script>

<div class="panel" style:margin-left="calc(30px + {depth * 2}ch)">
  <div class="head">
    <b class="mono">{column.path}</b>
    <span class="mono">column[{column.index}]</span>
    {#if field}<span class="mono">{field.logicalType} · field id {field.id}{field.nullable ? "" : " · not null"}</span
      >{/if}
  </div>
  <div class="facts">
    <span
      ><span class="k">size</span> {formatBytes(column.bytes)} ({percent(column.bytes, model.fileSize)} of file)</span
    >
    <span><span class="k">pages</span> {formatNumber(column.pages.length)}</span>
    <span><span class="k">metadata</span> {formatBytes(metaBytes)}</span>
    {#if column.buffers.length}
      <span><span class="k">column buffers</span> {formatNumber(column.buffers.length)}</span>
    {/if}
    {#if column.encoding.name !== "values"}
      <span><span class="k">column encoding</span> {column.encoding.name}</span>
    {/if}
  </div>

  {#if column.pages.length}
    <div class="label">Pages by row <span class="muted">· click one to open it</span></div>
    <div class="lane" role="group" aria-label="Pages of {column.path} by row">
      {#each segments as segment, i (segment.first.index)}
        {@const { first, last } = segment}
        {@const selected = inspector.selectedPage}
        <button
          type="button"
          class:selected={selected !== null && selected >= first.index && selected <= last.index}
          style:left="{(first.firstRow / totalRows) * 100}%"
          style:width="{((last.firstRow + last.numRows - first.firstRow) / totalRows) * 100}%"
          style:background={columnColor(column.index, column.index, i % 2 === 1)}
          title={describe(segment)}
          onclick={(event) => open(event, first)}
        ></button>
      {/each}
    </div>
    <div class="ends mono muted"><span>0</span><span>{formatNumber(totalRows)} rows</span></div>

    <div class="label">Encodings</div>
    <ul class="mix mono">
      {#each mix as [summary, count] (summary)}
        <li><span>{summary}</span><span class="muted">{count} {count === 1 ? "page" : "pages"}</span></li>
      {/each}
    </ul>
  {:else}
    <p class="muted empty">
      No pages{model.footer.version === "2.0" ? ": in 2.0 a struct column only exists to hold its children." : "."}
    </p>
  {/if}

  {#if metadata.length}
    <div class="label">Field metadata</div>
    <dl class="mono">
      {#each metadata as [key, value] (key)}
        <dt>{key}</dt>
        <dd title={value}>{value}</dd>
      {/each}
    </dl>
  {/if}
</div>

<style>
  .panel {
    margin: 4px 12px 8px 30px;
    padding: 10px 12px;
    border-radius: var(--radius);
    outline: 1px solid #e0e7ff;
    background: var(--surface);
    font-family: var(--font-sans);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    margin-bottom: 8px;
    font-size: 12.5px;
  }

  .head span {
    font-size: 11.5px;
    color: var(--text-4);
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 18px;
    margin-bottom: 10px;
    font-size: 12px;
  }

  .k {
    color: var(--text-4);
  }

  .label {
    margin: 8px 0 4px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-3);
  }

  .lane {
    position: relative;
    height: 14px;
    border-radius: 2px;
    background: var(--line-soft);
  }

  .lane button {
    position: absolute;
    top: 0;
    bottom: 0;
    min-width: 2px;
    padding: 0;
    border: 0;
    border-right: 1px solid #fff;
    cursor: pointer;
  }

  .lane button:hover,
  .lane button.selected {
    z-index: 1;
    outline: 2px solid var(--text);
  }

  .lane button.selected {
    outline-color: var(--accent);
  }

  .ends {
    display: flex;
    justify-content: space-between;
    margin-top: 2px;
    font-size: 10.5px;
  }

  .mix {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 11.5px;
  }

  .mix li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .empty {
    margin: 0;
    font-size: 12px;
  }

  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 2px 12px;
    margin: 0;
    font-size: 11.5px;
  }

  dt {
    color: var(--text-3);
  }

  dd {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 700px) {
    .panel {
      margin: 4px 0 8px !important;
    }
  }
</style>
