<script lang="ts">
  import Checks from "./Checks.svelte";
  import { getInspector } from "../lib/inspector.svelte";
  import { formatBytes, formatNumber } from "../lib/format";
  import { shareUrl, toQuery } from "../lib/share";

  const inspector = getInspector();
  const { model } = inspector;
  const { footer } = model;

  const stats = [
    { label: "Size", value: formatBytes(model.fileSize) },
    { label: "Rows", value: formatNumber(model.numRows) },
    { label: "Columns", value: formatNumber(model.columns.length) },
    { label: "Pages", value: formatNumber(model.columns.reduce((sum, c) => sum + c.pages.length, 0)) },
    { label: "Metadata", value: formatBytes(model.metadataBytes) },
  ];
  const raw = `${footer.major}.${footer.minor}`;
  const format = `Lance file ${model.version}${raw === model.version ? "" : ` · footer says ${raw}`}`;

  let copied = $state(false);

  async function copyLink() {
    const { source, selectedColumn, selectedPage } = inspector;
    if (source === null) return;
    const col = selectedColumn === null ? null : (model.columns[selectedColumn]?.path ?? null);
    await navigator.clipboard.writeText(shareUrl(toQuery({ ...source, col, page: selectedPage }), location));
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<section aria-label="File summary">
  <header>
    <h2 class="mono">{model.name}</h2>
    <span class="loaded">{inspector.loadSummary}</span>
    {#if inspector.source !== null}
      <button type="button" onclick={copyLink}>{copied ? "Copied" : "Copy link"}</button>
    {/if}
  </header>
  <dl>
    {#each stats as stat (stat.label)}
      <div>
        <dt>{stat.label}</dt>
        <dd>{stat.value}</dd>
      </div>
    {/each}
    <div class="format">
      <dt>Format</dt>
      <dd class="mono">{format}</dd>
    </div>
  </dl>
  {#each model.warnings as warning (warning)}
    <p class="warning">{warning}</p>
  {/each}
  <Checks />
</section>

<style>
  section {
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 12px;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    padding: 10px 12px 10px 16px;
    border-bottom: 1px solid var(--line);
    background: var(--surface-2);
  }

  h2 {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: 14px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .loaded {
    font-size: 12px;
    color: var(--text-3);
  }

  button {
    margin-left: auto;
    padding: 3px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-size: 12px;
    color: var(--text-2);
    cursor: pointer;
  }

  button:hover {
    border-color: #d1d5db;
  }

  dl {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr)) minmax(0, 1.6fr);
    gap: 12px;
    margin: 0;
    padding: 12px 16px;
  }

  dt {
    font-size: 11.5px;
    color: var(--text-3);
  }

  dd {
    margin: 2px 0 0;
    overflow: hidden;
    font-size: 15px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .format dd {
    margin-top: 4px;
    font-size: 12.5px;
    font-weight: 500;
  }

  .warning {
    margin: 0;
    padding: 8px 16px;
    border-top: 1px solid var(--line-soft);
    background: #fffbeb;
    font-size: 12px;
    color: #92400e;
  }

  @media (max-width: 700px) {
    header {
      padding: 10px 12px;
    }
    .loaded {
      order: 3;
      flex-basis: 100%;
    }
    dl {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      padding: 12px;
    }
    .format {
      grid-column: 1 / -1;
    }
  }
</style>
