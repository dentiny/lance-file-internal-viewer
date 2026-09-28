<script lang="ts">
  import Columns from "./Columns.svelte";
  import FileSummary from "./FileSummary.svelte";
  import FileMap from "./FileMap.svelte";
  import Popover from "./Popover.svelte";
  import Schema from "./Schema.svelte";
  import { setInspector, type Inspector } from "../lib/inspector.svelte";
  import { publishQuery, toQuery } from "../lib/share";

  let { inspector }: { inspector: Inspector } = $props();
  // The parent re-creates this component per file, so the inspector never changes underneath it.
  // svelte-ignore state_referenced_locally
  setInspector(inspector);

  $effect(() => {
    const { source, selectedColumn, selectedPage, model } = inspector;
    if (source === null) return;
    const col = selectedColumn === null ? null : (model.columns[selectedColumn]?.path ?? null);
    publishQuery(toQuery({ url: source, col, page: selectedPage }));
  });
</script>

<svelte:document onclick={() => inspector.hidePopover()} />

<main>
  <FileSummary />
  <FileMap />
  <div class="columns">
    <Schema />
    <Columns />
  </div>
</main>

<Popover />

<style>
  main {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 18px;
    margin-top: 18px;
  }

  .columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }

  @media (max-width: 900px) {
    .columns {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
