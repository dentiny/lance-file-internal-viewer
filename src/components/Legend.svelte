<script lang="ts">
  import { KINDS } from "../lib/kinds";
</script>

<div class="legend">
  <span class="item"><span class="swatch support"></span>chunk metadata / index</span>
  <span class="item"><span class="swatch data"></span>data buffer</span>
  <span class="item"><span class="swatch seam"></span>page boundary</span>
  <span class="item"><span class="swatch" style:background={KINDS.columnMeta.color}></span>column metadata</span>
</div>

<style>
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 13px;
    margin-top: 10px;
    font-size: 11.5px;
    color: var(--text-4);
  }

  .item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
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
</style>
