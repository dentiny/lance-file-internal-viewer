<script lang="ts">
  import { isObjectUri, type ServerConfig } from "../lib/lance/server";

  interface Props {
    value: string;
    /** Object storage region for `s3://` and `oci://` locations. */
    region: string | null;
    server: ServerConfig | null;
    onurl: (url: string) => void;
    onfile: (file: File) => void;
  }

  let { value = $bindable(), region = $bindable(), server, onurl, onfile }: Props = $props();

  const regions = $derived(server?.object_storage_regions ?? []);
  const showRegion = $derived(regions.length > 1 && isObjectUri(value));
  const placeholder = $derived(
    server
      ? "Paste s3://bucket/key.lance, an NFS path, a dataset directory, or any .lance URL"
      : "Paste a .lance file URL, a Hub file URL, or hf://datasets/owner/repo/data/file.lance",
  );

  const examples = [
    { label: "sensors (v2.1, dictionary, zstd)", url: "sensors.lance" },
    {
      label: "MNIST test split (images, full-zip)",
      url: "hf://datasets/lance-format/mnist-lance/data/test.lance/data/110010001100011101010111b0b1364b67a82b51d912b59a03.lance",
    },
    {
      label: "LAION-1M shard (20 GB, v2.0)",
      url: "hf://datasets/lance-format/laion-1m/data/train.lance/data/0000011100111001110110110bafaa437e8e158f207cad76ec.lance",
    },
  ];

  function onsubmit(event: SubmitEvent) {
    event.preventDefault();
    if (value.trim()) onurl(value);
  }

  function onchange(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    if (file) onfile(file);
  }
</script>

<form {onsubmit}>
  <input bind:value type="text" spellcheck="false" autocomplete="off" aria-label="Lance file URL" {placeholder} />
  {#if showRegion}
    <select bind:value={region} aria-label="Object storage region">
      {#each regions as r (r)}
        <option value={r}>{r}</option>
      {/each}
    </select>
  {/if}
  <button type="submit" class="primary">Inspect</button>
  <label class="secondary">Open file<input type="file" accept=".lance" hidden {onchange} /></label>
</form>

<div class="examples">
  <span class="muted">Try</span>
  {#each server?.nfs_roots ?? [] as root (root.logical)}
    <button type="button" class="storage" onclick={() => onurl(root.logical)}>NFS {root.logical}</button>
  {/each}
  {#each examples as example (example.url)}
    <button type="button" onclick={() => onurl(example.url)}>{example.label}</button>
  {/each}
</div>

<style>
  form {
    display: flex;
    gap: 8px;
  }

  input[type="text"] {
    flex: 1;
    padding: 9px 12px;
    border: 1px solid #d1d5db;
    border-radius: var(--radius);
    outline: none;
    font-family: var(--font-mono);
    font-size: 13px;
  }

  input[type="text"]:focus {
    border-color: #818cf8;
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .primary {
    padding: 0 16px;
    border: 0;
    border-radius: var(--radius);
    background: var(--text);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }

  .secondary {
    display: grid;
    place-items: center;
    padding: 0 14px;
    border: 1px solid #d1d5db;
    border-radius: var(--radius);
    color: var(--text-2);
    cursor: pointer;
  }

  select {
    padding: 0 8px;
    border: 1px solid #d1d5db;
    border-radius: var(--radius);
    background: var(--surface);
    font: inherit;
    font-family: var(--font-mono);
    font-size: 12.5px;
  }

  .examples button.storage {
    border-color: var(--accent-line);
    font-family: var(--font-mono);
  }

  .examples {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    font-size: 12px;
  }

  .examples button {
    padding: 3px 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 12px;
    color: var(--text-2);
    cursor: pointer;
  }

  .examples button:hover {
    border-color: var(--accent-line);
    background: var(--accent-soft);
  }

  @media (max-width: 700px) {
    form {
      flex-wrap: wrap;
    }
    input[type="text"] {
      flex-basis: 100%;
      font-size: 16px;
    }
    .primary,
    .secondary {
      flex: 1;
      height: 40px;
    }
    .examples {
      flex-wrap: nowrap;
      overflow-x: auto;
      padding-bottom: 4px;
    }
    .examples button {
      white-space: nowrap;
    }
  }
</style>
