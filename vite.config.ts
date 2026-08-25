/// <reference types="vitest/config" />
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import { viteSingleFile } from "vite-plugin-singlefile";

// ssh-config requires node:child_process / node:os at import time; in the
// browser Vite resolves them to empty namespaces that explode only when
// called (Match exec, CanonicalDomains nslookup). Alias both to stubs that
// fail fast — in the browser bundle AND dev server, but never in vitest
// where the real builtins exist.
const nodeStubs = [
  { find: /^node:child_process$/, replacement: "/src/lib/stubs.ts" },
  { find: /^node:os$/, replacement: "/src/lib/stubs.ts" },
];

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [svelte(), viteSingleFile()],
  // BISECT: alias disabled
  resolve: mode === "test" ? undefined : { alias: nodeStubs },
  test: {
    environment: "node",
  },
}));
