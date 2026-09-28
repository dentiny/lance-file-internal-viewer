<script lang="ts">
  import type { LanceModel } from "../lib/lance/model";

  let { model }: { model: LanceModel } = $props();
</script>

<span class="version mono" title="Lance file format {model.version}">Lance {model.version}</span>

<style>
  .version {
    display: inline-flex;
    flex: none;
    align-items: center;
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--accent-line);
    border-radius: var(--radius);
    background: var(--accent-soft);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--accent);
    white-space: nowrap;
  }
</style>
