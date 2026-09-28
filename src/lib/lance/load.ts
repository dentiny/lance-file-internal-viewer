import { readMetadata } from "./metadata";
import { buildModel, type LanceModel } from "./model";
import { tailBuffer, type ReadCounter, type Source } from "./source";

export interface Loaded {
  model: LanceModel;
  counter: ReadCounter;
}

/** Reads the footer, column metadata and schema of a Lance file and lays out every byte range. */
export async function loadLance(name: string, open: () => Promise<Source>): Promise<Loaded> {
  const { file, counter } = tailBuffer(await open());
  const metadata = await readMetadata(file);
  return { model: buildModel(name, file.byteLength, metadata), counter };
}

/** A sentence saying why a file couldn't be read, for the status line. */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof TypeError && /fetch/i.test(message)) {
    return "the request was blocked. Check the URL, and that the server allows cross-origin (CORS) range requests.";
  }
  if (/LANC|footer|protobuf|outside the file/i.test(message))
    return `this doesn't look like a Lance file (${message}).`;
  return message;
}
