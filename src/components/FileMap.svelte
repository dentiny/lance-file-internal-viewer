<script lang="ts">
  import ByteStrip from "./ByteStrip.svelte";
  import Legend from "./Legend.svelte";
  import { formatBytes, formatNumber } from "../lib/format";
  import { getInspector } from "../lib/inspector.svelte";
  import { pageTarget } from "../lib/lance/model";

  const inspector = getInspector();
  const { model } = inspector;

  const body = model.pieces.filter((p) => p.start < model.tailStart);
  const tail = model.pieces.filter((p) => p.start >= model.tailStart);
  const targets = model.pages.map(pageTarget);
  const selected = $derived.by(() => {
    const page = inspector.page;
    return page ? (targets.find((t) => t.page === page) ?? null) : null;
  });
</script>

<section class="card">
  <div class="strips" class:tail-only={model.tailStart === 0}>
    {#if model.tailStart > 0}
      <div>
        <div class="caption">
          <span>
            <b>Data</b> · {formatNumber(model.pages.length)} pages · {formatBytes(model.padding)} alignment padding · click
            a page to open it
          </span>
          <span>{formatBytes(model.tailStart)}</span>
        </div>
        <ByteStrip
          pieces={body}
          from={0}
          to={model.tailStart}
          label="File layout"
          {targets}
          {selected}
          highlighted={inspector.hoveredPage}
          onpick={(target) => inspector.togglePage(target.page, { reveal: true })}
        />
      </div>
    {/if}
    <div>
      <div class="caption">
        <span><b>Metadata + footer</b> magnified</span>
        <span>{formatBytes(model.fileSize - model.tailStart)}</span>
      </div>
      <ByteStrip pieces={tail} from={model.tailStart} to={model.fileSize} label="Metadata and footer" />
    </div>
  </div>
  <Legend />
  <p class="hint">
    <span class="on-hover">Hover a buffer for details, click to open its page below.</span>
    <span class="on-touch">Tap a page to open it below.</span>
  </p>
</section>

<style>
  .card {
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
  }

  .strips {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 220px;
    gap: 16px;
  }

  .strips.tail-only {
    grid-template-columns: minmax(0, 1fr);
  }

  .caption {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
    font-size: 11px;
    color: var(--text-4);
  }

  .caption b {
    font-weight: 500;
    color: var(--text-2);
  }

  .hint {
    margin: 6px 0 0;
    font-size: 11.5px;
    color: var(--text-4);
  }

  @media (max-width: 700px) {
    .card {
      padding: 12px;
    }
    .strips {
      grid-template-columns: minmax(0, 1fr);
      gap: 10px;
    }
  }
</style>
