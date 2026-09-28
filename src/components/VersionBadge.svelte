<script lang="ts">
  import type { LanceModel } from "../lib/lance/model";

  let { model }: { model: LanceModel } = $props();

  /** The storage version as the footer stores it; 2.0 files store 0.3. */
  const raw = $derived(`${model.footer.major}.${model.footer.minor}`);
  const title = $derived(
    raw === model.version
      ? `Lance file format ${model.version}`
      : `Lance file format ${model.version} (the footer stores it as ${raw})`,
  );
</script>

<span class="version mono" {title}>Lance {model.version}</span>

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
