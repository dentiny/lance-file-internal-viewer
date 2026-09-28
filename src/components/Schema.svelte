<script lang="ts">
  import ColumnName from "./ColumnName.svelte";
  import ColumnPanel from "./ColumnPanel.svelte";
  import { columnColor } from "../lib/colors";
  import { formatBytes } from "../lib/format";
  import { getInspector } from "../lib/inspector.svelte";
  import { columnFields, schemaLines } from "../lib/lance/schema";

  const inspector = getInspector();
  const { model } = inspector;
  const lines = schemaLines(model.fields, columnFields(model.fields, model.version));
  const totalBytes = model.columns.reduce((sum, c) => sum + c.bytes, 0) || 1;
</script>

{#snippet code(line: (typeof lines)[number])}
  <span class="code" style:padding-left="{line.depth * 2}ch">
    {#if line.depth === 0 && line.name}
      <span class="kw">{line.name}</span>
    {:else if line.name}
      <ColumnName name={line.name} /><span class="colon">:&nbsp;</span><span class="ty">{line.type}</span>
    {/if}
    {#if line.annotation}<span class="an">&nbsp;{line.annotation}</span>{/if}
    <span
      >{#if line.punct === "{"}&nbsp;{/if}{line.punct}</span
    >
  </span>
{/snippet}

<section>
  <h2>Schema <small>size on disk · click a column to find it in the file</small></h2>
  <div class="schema mono">
    {#each lines as line, n (n)}
      {@const column = line.column}
      {#if column === undefined}
        <div class="line">
          <span class="n">{n + 1}</span>
          {@render code(line)}
        </div>
      {:else}
        {@const color = columnColor(column, inspector.selectedColumn)}
        {@const bytes = model.columns[column]?.bytes ?? 0}
        <button
          type="button"
          class="line leaf"
          aria-label="Column {model.columns[column]?.path}, {formatBytes(bytes)}"
          aria-pressed={inspector.selectedColumn === column}
          class:selected={inspector.selectedColumn === column}
          onclick={() => inspector.toggleColumn(column, { reveal: true })}
        >
          <span class="n">{n + 1}</span>
          {@render code(line)}
          <span class="size">
            <span class="bar"><span style:width="{(bytes / totalBytes) * 100}%" style:background={color}></span></span>
            <span class="swatch" style:background={color}></span>
            <span class="value">{formatBytes(bytes)}</span>
          </span>
        </button>
        {#if inspector.selectedColumn === column}
          <ColumnPanel {column} depth={line.depth} />
        {/if}
      {/if}
    {/each}
  </div>
</section>

<style>
  .schema {
    padding: 6px 0;
    border-radius: var(--radius);
    outline: 1px solid var(--line);
    background: var(--surface-2);
    font-size: 12.5px;
  }

  .line {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) 130px;
    align-items: center;
    width: 100%;
    height: 24px;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    text-align: left;
  }

  .leaf {
    cursor: pointer;
  }

  .leaf:hover,
  .selected {
    background: var(--accent-soft);
  }

  .selected {
    box-shadow: inset 3px 0 0 #818cf8;
  }

  .n {
    padding-right: 10px;
    color: #d1d5db;
    text-align: right;
  }

  .code {
    display: flex;
    min-width: 0;
    padding-right: 12px;
    overflow: hidden;
    white-space: pre;
  }

  .code > :global(*) {
    flex: none;
  }

  .code > :global(.name) {
    flex: 0 1 auto;
    font-weight: 600;
  }

  .kw {
    color: #e11d48;
  }

  .colon {
    color: var(--text-4);
  }

  .ty {
    color: #7c3aed;
  }

  /* Annotations give way before names do. */
  .code > .an {
    flex: 0 1000 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #0d9488;
  }

  .size {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-right: 12px;
    font-size: 11px;
    color: var(--text-4);
  }

  .bar {
    position: relative;
    flex: 1;
    height: 4px;
    border-radius: 1px;
    background: #eceef2;
  }

  .bar > span {
    position: absolute;
    inset: 0 auto 0 0;
    min-width: 1px;
    border-radius: 1px;
  }

  .size .swatch {
    display: none;
    width: 8px;
    height: 8px;
  }

  .value {
    width: 60px;
    text-align: right;
    white-space: nowrap;
  }

  @media (max-width: 700px) {
    .line {
      grid-template-columns: 26px minmax(0, 1fr) 64px;
    }
    .bar {
      display: none;
    }
    .size .swatch {
      display: block;
    }
    .value {
      width: auto;
    }
  }
</style>
