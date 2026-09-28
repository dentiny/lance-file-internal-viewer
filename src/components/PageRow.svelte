<script lang="ts">
  import EncodingTree from "./EncodingTree.svelte";
  import { pieceColor } from "../lib/colors";
  import { formatBytes, formatNumber, rowRange } from "../lib/format";
  import { getInspector } from "../lib/inspector.svelte";
  import { encodingSummary } from "../lib/lance/encoding";
  import type { Page } from "../lib/lance/model";

  let { page, maxPage }: { page: Page; maxPage: number } = $props();

  const inspector = getInspector();
  const open = $derived(inspector.selectedColumn === page.column.index && inspector.selectedPage === page.index);

  function hover(event: PointerEvent, entering: boolean) {
    if (event.pointerType === "mouse") inspector.hoveredPage = entering ? page : null;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="page"
  class:open
  onpointerenter={(event) => hover(event, true)}
  onpointerleave={(event) => hover(event, false)}
>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="row" onclick={() => inspector.togglePage(page)}>
    <button type="button" class="name mono" aria-expanded={open}>page {page.index}</button>
    <div class="buffers" style:width="{Math.max(6, (page.bytes / maxPage) * 100)}%">
      {#each page.buffers as buffer (buffer.buffer)}
        <div
          style:flex="{buffer.end - buffer.start} 0 0"
          style:background={pieceColor(buffer, inspector.selectedColumn)}
          onpointermove={(event) => event.pointerType === "mouse" && inspector.showPopover(buffer, event)}
          onpointerleave={() => inspector.hidePopover()}
        ></div>
      {/each}
    </div>
    <span class="size mono">{formatBytes(page.bytes)}</span>
    <span class="encoding mono">{encodingSummary(page.encoding)}</span>
    <span class="rows">rows {rowRange(page.firstRow, page.numRows)}</span>
  </div>
  {#if open}
    <div class="detail">
      <EncodingTree tree={page.encoding.tree} />
      <div class="table mono">
        <div class="head"><span>#</span><span>buffer</span><span>bytes</span><span class="r">size</span></div>
        {#each page.buffers as buffer (buffer.buffer)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="entry"
            onpointermove={(event) => event.pointerType === "mouse" && inspector.showPopover(buffer, event)}
            onpointerleave={() => inspector.hidePopover()}
          >
            <span class="muted">{buffer.buffer}</span>
            <span class="role">
              <span class="swatch" style:background={pieceColor(buffer, inspector.selectedColumn)}></span>
              {buffer.role ?? "buffer"}
            </span>
            <span>{formatNumber(buffer.start)}–{formatNumber(buffer.end)}</span>
            <span class="r">{formatBytes(buffer.end - buffer.start)}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .page {
    border-bottom: 1px solid #f3f4f6;
  }

  .page:last-of-type {
    border: 0;
  }

  .row {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr) 64px;
    grid-template-areas: "name buffers size" "name encoding rows";
    gap: 2px 12px;
    align-items: center;
    padding: 6px 0;
    cursor: pointer;
  }

  .open .row {
    background: var(--accent-soft);
  }

  .row > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name {
    grid-area: name;
    align-self: start;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
  }

  .buffers {
    grid-area: buffers;
    display: flex;
    gap: 1px;
    height: 10px;
  }

  .buffers > div {
    min-width: 2px;
    height: 100%;
    border-radius: 1px;
  }

  .buffers > div:hover {
    position: relative;
    z-index: 1;
    outline: 2px solid var(--text);
  }

  .size {
    grid-area: size;
    text-align: right;
  }

  .encoding {
    grid-area: encoding;
    font-size: 11px;
    color: #4b5563;
  }

  .row > .rows {
    grid-area: rows;
    overflow: visible;
    font-size: 11px;
    color: var(--text-4);
    text-align: right;
    white-space: nowrap;
  }

  .detail {
    margin: 2px 0 8px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    outline: 1px solid #e0e7ff;
    background: var(--surface);
  }

  .table {
    margin-top: 8px;
    font-size: 11.5px;
  }

  .head,
  .entry {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) minmax(0, 1fr) 60px;
    gap: 8px;
    align-items: center;
    height: 22px;
  }

  .head {
    font-family: var(--font-sans);
    font-size: 11px;
    color: var(--text-4);
  }

  .entry > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .role {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .r {
    text-align: right;
  }

  @media (max-width: 700px) {
    .row {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: "name size" "buffers buffers" "encoding rows";
    }
    .buffers {
      height: 14px;
    }
    .head,
    .entry {
      grid-template-columns: 16px minmax(0, 1fr) 56px;
    }
    .head > :nth-child(3),
    .entry > :nth-child(3) {
      display: none;
    }
  }
</style>
