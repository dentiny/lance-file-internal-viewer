<script lang="ts">
  import ColumnName from "./ColumnName.svelte";
  import { columnColor } from "../lib/colors";
  import { formatBytes, formatNumber, percent } from "../lib/format";
  import { getInspector } from "../lib/inspector.svelte";
  import { columnShares } from "../lib/lance/model";

  /** Columns listed by name until asked for the rest; the bar always shows all of them. */
  const MAX_NAMED = 12;

  const inspector = getInspector();
  const shares = columnShares(inspector.model);
  let showAll = $state(false);
  const named = $derived(showAll ? shares : shares.slice(0, MAX_NAMED));

  function pick(event: MouseEvent, column: number) {
    event.stopPropagation();
    inspector.toggleColumn(column, { reveal: true });
  }
</script>

{#if shares.length}
  <div class="breakdown">
    <div class="caption">
      <span><b>By column</b> · share of column bytes, wherever they sit in the file · click one to select it</span>
    </div>
    <div class="bar" role="group" aria-label="Bytes by column">
      {#each shares as { column, share } (column.index)}
        <button
          type="button"
          class:selected={inspector.selectedColumn === column.index}
          style:flex="{share} 0 3px"
          style:background={columnColor(column.index, inspector.selectedColumn)}
          title="{column.path} · {formatBytes(column.bytes)} · {percent(share, 1)}"
          aria-label="{column.path}, {percent(share, 1)} of column bytes"
          onclick={(event) => pick(event, column.index)}
        >
          {#if share > 0.08}<span class="mono">{column.path} {percent(share, 1)}</span>{/if}
        </button>
      {/each}
    </div>
    <div class="names">
      {#each named as { column, share } (column.index)}
        <button
          type="button"
          class="item"
          class:dim={inspector.selectedColumn !== null && inspector.selectedColumn !== column.index}
          onclick={(event) => pick(event, column.index)}
        >
          <span class="swatch" style:background={columnColor(column.index, null)}></span>
          <span class="mono path"><ColumnName name={column.path} /></span>
          <span class="share">{percent(share, 1)}</span>
        </button>
      {/each}
      {#if named.length < shares.length}
        <button type="button" class="more" onclick={() => (showAll = true)}>
          +{formatNumber(shares.length - named.length)} more
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .breakdown {
    margin-top: 12px;
  }

  .caption {
    margin-bottom: 4px;
    font-size: 11px;
    color: var(--text-4);
  }

  .caption b {
    font-weight: 500;
    color: var(--text-2);
  }

  .bar {
    display: flex;
    gap: 1px;
    height: 22px;
    overflow: hidden;
    border-radius: 3px;
  }

  .bar button {
    min-width: 0;
    padding: 0 6px;
    overflow: hidden;
    border: 0;
    font-size: 11px;
    color: #1f2937;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }

  .bar button:hover,
  .bar button.selected {
    outline: 2px solid var(--text);
    outline-offset: -2px;
  }

  .bar button.selected {
    outline-color: var(--accent);
  }

  .names {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 14px;
    margin-top: 8px;
    font-size: 11.5px;
    color: #4b5563;
  }

  .item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  .item:hover .path {
    text-decoration: underline;
  }

  .path {
    display: flex;
    min-width: 0;
  }

  .share {
    color: var(--text-4);
  }

  .dim {
    opacity: 0.4;
  }

  .more {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
  }
</style>
