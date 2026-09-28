<script lang="ts">
  import { encodingLines, type EncodingNode } from "../lib/lance/encoding";

  let { tree }: { tree: EncodingNode | null } = $props();
  const lines = $derived(encodingLines(tree));
</script>

<div class="tree mono" aria-label="Encoding">
  {#each lines as line, i (i)}
    <div style:padding-left="{line.depth * 2}ch">
      {#if line.role}<span class="role">{line.role}:</span>{/if}
      <span>{line.text}</span>
    </div>
  {:else}
    <div class="muted">No encoding description.</div>
  {/each}
</div>

<style>
  .tree {
    font-size: 11.5px;
    line-height: 1.6;
    color: var(--text-2);
    overflow-wrap: anywhere;
  }

  .role {
    color: #0d9488;
  }
</style>
