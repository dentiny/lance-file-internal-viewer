import { readFile } from "node:fs/promises";
import { loadLance, type Loaded } from "../src/lib/lance/load";
import { fileSource } from "../src/lib/lance/source";

export async function loadFixture(path: string): Promise<Loaded> {
  const bytes = await readFile(path);
  return loadLance(path.split("/").pop() ?? path, () => fileSource(new Blob([bytes])));
}

/** What Lance's own reader (pylance) reported for a fixture when it was written. */
export interface Expected {
  version: string;
  num_rows: number;
  columns: { pages: { buffers: [number, number][]; encodings: string[] }[]; column_buffers: [number, number][] }[];
  global_buffers: [number, number][];
}

export async function expected(name: string): Promise<Expected> {
  return JSON.parse(await readFile(`tests/fixtures/${name}.json`, "utf8")) as Expected;
}
