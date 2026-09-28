<script lang="ts">
  import EmptyState from "./components/EmptyState.svelte";
  import GitHubLink from "./components/GitHubLink.svelte";
  import SourceInput from "./components/SourceInput.svelte";
  import Viewer from "./components/Viewer.svelte";
  import { Inspector } from "./lib/inspector.svelte";
  import { formatBytes } from "./lib/format";
  import DirectoryBrowser from "./components/DirectoryBrowser.svelte";
  import { describeError, loadLance } from "./lib/lance/load";
  import {
    fetchServerConfig,
    isObjectUri,
    listLocation,
    needsServer,
    rawUrl,
    statLocation,
    type Listing,
    type ServerConfig,
  } from "./lib/lance/server";
  import { fileSource, resolveUrl, urlSource, type Source } from "./lib/lance/source";
  import { fromQuery, publishQuery, toQuery } from "./lib/share";

  type Initial = { col: string | null; page: number | null };

  let input = $state("");
  let status = $state<{ text: string; error?: boolean } | null>(null);
  let inspector = $state.raw<Inspector | null>(null);
  let directory = $state.raw<{ uri: string; region: string | null; listing: Listing } | null>(null);
  let server = $state.raw<ServerConfig | null>(null);
  let region = $state<string | null>(null);
  let dragging = $state(false);
  /** Ignores results from a load that a newer one replaced. */
  let loadId = 0;

  const serverReady = fetchServerConfig().then((config) => {
    server = config;
    region ??= config?.object_storage_regions[0] ?? null;
  });

  async function load(
    id: number,
    name: string,
    open: () => Promise<Source>,
    source: { url: string; region: string | null } | null,
    initial: Initial = { col: null, page: null },
  ) {
    status = { text: `Reading ${name}…` };
    const started = performance.now();
    try {
      const { model, counter } = await loadLance(name, open);
      if (id !== loadId) return;
      const ms = Math.round(performance.now() - started);
      const requests = `${counter.requests} request${counter.requests === 1 ? "" : "s"}`;
      const summary = `read ${formatBytes(counter.bytes)} of ${formatBytes(model.fileSize)} · ${requests} · ${ms} ms`;
      inspector = new Inspector(model, source, initial, summary);
      status = null;
    } catch (error) {
      if (id !== loadId) return;
      console.error(error);
      status = { text: `Couldn't read ${name}: ${describeError(error)}`, error: true };
    }
  }

  /** Opens a location the server reads: a Lance file, or a directory to pick one from. */
  async function openStored(id: number, uri: string, initial?: Initial) {
    const storageRegion = isObjectUri(uri) ? region : null;
    const name = uri.replace(/\/+$/, "").split("/").pop() || uri;
    if (!server) {
      status = {
        text: `Couldn't read ${name}: S3, OCI and NFS locations are read by the server (see server/README.md), which isn't running behind this page.`,
        error: true,
      };
      return;
    }
    status = { text: `Opening ${name}…` };
    try {
      const stat = await statLocation(uri, storageRegion);
      if (id !== loadId) return;
      if (stat.kind === "directory") {
        const listing = await listLocation(uri, storageRegion);
        if (id !== loadId) return;
        directory = { uri, region: storageRegion, listing };
        status = null;
        publishQuery(toQuery({ url: uri, region: storageRegion, col: null, page: null }));
        return;
      }
      await load(id, name, () => urlSource(rawUrl(uri, storageRegion)), { url: uri, region: storageRegion }, initial);
    } catch (error) {
      if (id !== loadId) return;
      console.error(error);
      status = { text: `Couldn't open ${name}: ${describeError(error)}`, error: true };
    }
  }

  async function openUrl(raw: string, initial?: Initial) {
    const id = ++loadId;
    input = raw;
    inspector = null;
    directory = null;
    await serverReady;
    if (id !== loadId) return;
    if (needsServer(raw, server)) return openStored(id, raw, initial);
    const name = raw.split("/").pop() ?? raw;
    return load(id, name, () => urlSource(resolveUrl(raw)), { url: raw, region: null }, initial);
  }

  function openFile(file: File) {
    const id = ++loadId;
    input = file.name;
    inspector = null;
    directory = null;
    void load(id, file.name, () => fileSource(file), null);
  }

  function ondrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    const file = event.dataTransfer?.files[0];
    if (file) openFile(file);
  }

  const initial = fromQuery(location.search);
  if (initial) {
    if (initial.region) region = initial.region;
    void openUrl(initial.url, initial);
  }
</script>

<svelte:window
  ondragover={(event) => {
    event.preventDefault();
    dragging = true;
  }}
  ondragleave={(event) => {
    if (!event.relatedTarget) dragging = false;
  }}
  {ondrop}
/>

<div class="page">
  <header>
    <div class="title">
      <h1><span class="logo" aria-hidden="true">▦</span> Lance File Internal Storage</h1>
      <GitHubLink />
    </div>
    <p>See how a Lance file is laid out, byte by byte. Only the footer, column metadata and schema are downloaded.</p>
  </header>

  <SourceInput bind:value={input} bind:region {server} onurl={(url) => openUrl(url)} onfile={openFile} />

  <p class="status" class:error={status?.error} role="status">{status?.text ?? ""}</p>

  {#if inspector}
    {#key inspector}
      <Viewer {inspector} />
    {/key}
  {:else if directory}
    <DirectoryBrowser {...directory} onopen={(uri) => openUrl(uri)} />
  {:else if !status?.text}
    <EmptyState />
  {/if}
</div>

{#if dragging}
  <div class="drop">Drop a .lance file anywhere</div>
{/if}

<style>
  .page {
    max-width: 1280px;
    margin: 0 auto;
    padding: 28px 28px 60px;
  }

  header {
    margin-bottom: 16px;
  }

  .title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  h1 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 20px;
  }

  .logo {
    color: #6366f1;
  }

  header p {
    margin: 4px 0 0;
    color: var(--text-3);
  }

  .status {
    min-height: 18px;
    margin: 18px 0 0;
    font-size: 12px;
    color: var(--text-3);
  }

  .status:empty {
    min-height: 0;
    margin: 0;
  }

  .status.error {
    color: var(--error);
  }

  .drop {
    position: fixed;
    inset: 12px;
    z-index: 20;
    display: grid;
    place-items: center;
    border: 2px dashed #818cf8;
    border-radius: 16px;
    background: rgb(238 242 255 / 85%);
    font-size: 18px;
    color: #4338ca;
    pointer-events: none;
  }

  @media (max-width: 700px) {
    .page {
      padding: 18px 14px 40px;
    }
    h1 {
      font-size: 18px;
    }
    header p {
      font-size: 12.5px;
    }
  }
</style>
