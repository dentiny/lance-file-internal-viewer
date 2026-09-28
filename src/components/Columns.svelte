<script lang="ts">
  import ColumnItem from "./ColumnItem.svelte";
  import { formatNumber } from "../lib/format";
  import { getInspector } from "../lib/inspector.svelte";

  const inspector = getInspector();
  const { columns } = inspector.model;
  const maxBytes = Math.max(1, ...columns.map((c) => c.bytes));
  let list: HTMLDivElement;

  // Selections made outside the list (file map, schema, a shared link) scroll it to the open column or page.
  $effect(() => {
    if (!inspector.revealTick) return;
    const open = list.querySelector<HTMLElement>(".page.open") ?? list.querySelector<HTMLElement>(".item.open");
    if (!open) return;
    const top = open.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    list.scrollTop = top - 30;
    if (inspector.revealInPage) open.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
</script>

<section>
  <h2>Columns <small>{formatNumber(columns.length)} · click one to see its pages</small></h2>
  <div class="list" bind:this={list}>
    <div class="header">
      <span></span><span>#</span><span>column</span><span class="r">pages</span><span></span><span class="r">size</span>
    </div>
    {#each columns as column (column.index)}
      <ColumnItem {column} {maxBytes} />
    {/each}
  </div>
</section>

<style>
  .list {
    --col-columns: 14px 28px minmax(0, 1.2fr) 44px minmax(0, 1fr) 64px;
    position: relative;
    max-height: 640px;
    overflow: hidden auto;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    font-size: 12px;
    scrollbar-gutter: stable;
  }

  .header {
    position: sticky;
    top: 0;
    z-index: 2;
    display: grid;
    grid-template-columns: var(--col-columns);
    gap: 10px;
    align-items: center;
    height: 26px;
    padding: 0 12px;
    border-bottom: 1px solid var(--line-soft);
    background: var(--surface);
    font-size: 11px;
    color: var(--text-4);
  }

  .r {
    text-align: right;
  }

  @media (max-width: 700px) {
    .list {
      --col-columns: 12px 24px minmax(0, 1fr) 36px 58px;
      max-height: 70vh;
    }
    .header {
      gap: 8px;
      padding: 0 10px;
    }
    .header > :nth-child(5) {
      display: none;
    }
  }
</style>
