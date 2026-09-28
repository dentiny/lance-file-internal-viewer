import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/** The storage version in a Lance file's footer: u16 major and minor, 8 and 6 bytes before the end. */
function storageVersion(path: string): string {
  const bytes = readFileSync(path);
  const major = bytes.readUInt16LE(bytes.length - 8);
  const minor = bytes.readUInt16LE(bytes.length - 6);
  // Lance writes 2.0 files with 0.3 in the footer.
  return major === 0 && minor === 3 ? "2.0" : `${major}.${minor}`;
}

async function openSensors(page: Page, query = "") {
  await page.goto(`/?url=sensors.lance${query}`);
  await expect(page.getByRole("region", { name: "File summary" })).toContainText(/read .* of 4\.6 MB/);
}

test("shows the file facts and layout checks", async ({ page }) => {
  await openSensors(page);
  await expect(page.getByText("400,000")).toBeVisible();
  const version = storageVersion("public/sensors.lance");
  await expect(page.getByTitle(`Lance file format ${version}`)).toHaveText(`Lance ${version}`);
  await expect(page.getByRole("button", { name: /Compressed/ })).toContainText("temperature");
  await expect(page.getByRole("button", { name: /Dictionary/ })).toContainText("sensor_id");
});

test("opens a page from the file map and mirrors it in the URL", async ({ page, isMobile }) => {
  await openSensors(page);
  const strip = page.getByLabel("File layout");
  const box = await strip.boundingBox();
  if (!box) throw new Error("no strip");
  const position = { x: box.width * 0.02, y: box.height / 2 };
  if (isMobile) await strip.tap({ position });
  else await strip.click({ position });
  await expect(page).toHaveURL(/col=sensor_id&page=0/);
  await expect(page.locator(".item > [aria-expanded=true]")).toContainText("sensor_id");
  await expect(page.getByLabel("Encoding")).toContainText("dictionary: variable");
});

test("selecting a column shows how its pages split the rows", async ({ page }) => {
  await openSensors(page);
  await page.getByRole("button", { name: /^Column note,/ }).click();
  await expect(page).toHaveURL(/col=note/);
  const lane = page.getByRole("group", { name: "Pages of note by row" });
  await expect(lane.getByRole("button")).toHaveCount(9);
  await lane.getByRole("button").nth(3).click();
  await expect(page).toHaveURL(/col=note&page=3/);
  await expect(page.getByLabel("Encoding")).toContainText("definition: bitpacking");
});

test("restores a shared link", async ({ page }) => {
  await openSensors(page, "&col=temperature&page=1");
  await expect(page.locator(".page.open")).toContainText("rows 280,000 – 399,999");
  await expect(page.getByLabel("Encoding")).toContainText("zstd");
});

test("hovering the file map explains the buffer under the pointer", async ({ page, isMobile }) => {
  test.skip(isMobile, "no hover on touch screens");
  await openSensors(page);
  const strip = page.getByLabel("Metadata and footer");
  const box = await strip.boundingBox();
  if (!box) throw new Error("no strip");
  await page.mouse.move(box.x + box.width * 0.02, box.y + box.height / 2);
  const popover = page.getByRole("tooltip");
  await expect(popover).toContainText("Schema (global buffer 0)");
  await expect(popover).toContainText("400,000");
});

test("reports files that aren't Lance files", async ({ page }) => {
  await page.goto("/?url=index.html");
  await expect(page.getByRole("status")).toContainText("doesn't look like a Lance file");
});
