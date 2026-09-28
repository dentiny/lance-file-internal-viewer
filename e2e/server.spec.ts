import { expect, test } from "@playwright/test";

/**
 * Runs against the Rust server with a local S3 and NFS directory, as set up by `scripts/server-e2e.sh`:
 * `s3://lance-test/warehouse/sensors.lance` and `/mnt/shared/team/sensors.lance` hold copies of the sample.
 */
const SERVER = process.env.LANCE_VIEWER_E2E_URL;
test.skip(!SERVER, "set LANCE_VIEWER_E2E_URL, e.g. with scripts/server-e2e.sh");
test.use({ baseURL: SERVER });

test("browses an S3 dataset and opens one of its data files", async ({ page }) => {
  await page.goto(`/?url=${encodeURIComponent("s3://lance-test/warehouse/sensors.lance")}`);
  const browser = page.getByRole("region", { name: "Directory" });
  await expect(browser).toContainText("This is a Lance dataset");
  await browser.getByRole("list").getByRole("button", { name: "data/", exact: true }).click();
  await browser.getByRole("button", { name: "0a1b2c.lance" }).click();
  await expect(page.getByRole("region", { name: "File summary" })).toContainText("read 512 KB of 4.6 MB · 1 request");
  await expect(page.getByText("400,000")).toBeVisible();
  await expect(page).toHaveURL(/region=us-east-1/);
});

test("opens a file on NFS by its path", async ({ page }) => {
  await page.goto(`/?url=${encodeURIComponent("/mnt/shared/team/sensors.lance/data/1d2e3f.lance")}`);
  await expect(page.getByRole("region", { name: "File summary" })).toContainText("Lance file 2.0");
});

test("reports locations outside the configured NFS roots", async ({ page }) => {
  await page.goto(`/?url=${encodeURIComponent("/etc/passwd")}`);
  await expect(page.getByRole("status")).toContainText("is not under a configured NFS root");
});
