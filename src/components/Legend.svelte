<script lang="ts">
  import ColumnName from "./ColumnName.svelte";
  import { columnColor } from "../lib/colors";
  import { formatNumber } from "../lib/format";
  import { getInspector } from "../lib/inspector.svelte";
  import { KINDS } from "../lib/kinds";

  const MAX_COLUMNS = 12;

  const inspector = getInspector();
  const stored = inspector.model.columns.filter((c) => c.bytes > 0);
  const shown = stored.slice(0, MAX_COLUMNS);
  const hidden = stored.length - shown.length;
</script>

<div class="legend">
  {#each shown as column (column.index)}
    <span class="item" class:dim={inspector.selectedColumn !== null && inspector.selectedColumn !== column.index}>
      <span class="swatch" style:background={columnColor(column.index, null)}></span>
      <span class="mono path"><ColumnName name={column.path} /></span>
    </span>
  {/each}
  {#if hidden > 0}
    <span class="muted">+{formatNumber(hidden)} more</span>
  {/if}
  <span class="key">
    <span class="item"><span class="swatch support"></span>chunk metadata / index</span>
    <span class="item"><span class="swatch data"></span>data buffer</span>
    <span class="item"><span class="swatch seam"></span>page boundary</span>
    <span class="item"><span class="swatch" style:background={KINDS.columnMeta.color}></span>column metadata</span>
  </span>
</div>

<style>
  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 14px;
    margin-top: 10px;
    font-size: 11.5px;
    color: #4b5563;
  }

  .item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    min-width: 0;
  }

  .path {
    display: flex;
    min-width: 0;
  }

  .dim {
    opacity: 0.4;
  }

  .key {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px 13px;
    margin-left: auto;
    color: var(--text-4);
  }

  .support {
    background: var(--line);
  }

  .data {
    background: #b8bec8;
  }

  .seam {
    background: linear-gradient(90deg, #b8bec8 40%, #fff 40% 60%, #b8bec8 60%);
  }

  @media (max-width: 700px) {
    .key {
      margin-left: 0;
    }
  }
</style>
