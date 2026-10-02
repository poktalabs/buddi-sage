import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// `pnpm dev:prod` (SAGE_PROD_DATA=1) runs the local Worker against the production D1, so the
// owner Dashboard shows the real codes. Everything else local then writes to production too:
// redeeming, Rounds, issuing codes. Dev server only; a build never carries it.
export default defineConfig(({ command }) => {
  const prodData = command === "serve" && process.env.SAGE_PROD_DATA === "1";
  if (prodData) console.warn("\n  SAGE_PROD_DATA=1: the local Worker reads and writes the PRODUCTION database.\n");
  return {
    plugins: [
      cloudflare({
        // Mutated in place: a returned object is deep-merged, which would append a second D1 binding.
        config: (worker) => {
          if (!prodData) return;
          for (const db of worker.d1_databases ?? []) db.remote = true;
        },
      }),
    ],
  };
});
