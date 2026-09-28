import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
  build: { target: "es2022" },
  // `npm run dev` talks to the Rust server (`cargo run` in server/) for S3, OCI and NFS locations.
  server: { proxy: { "/api": "http://localhost:8080" } },
  test: { include: ["tests/**/*.test.ts"] },
});
