import { defineConfig } from "vitest/config";

// Pure-logic tests run in Node, without the Cloudflare Vite plugin.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
