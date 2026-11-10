import { defineConfig, loadEnv } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import packageJson from "./package.json" with { type: "json" };
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  const define: Record<string, string> = {
    APP_TITLE: env.VITE_APP_TITLE || "Machirun",
    APP_SHORT_TITLE: env.VITE_APP_SHORT_TITLE || "Machirun",
    APP_URL: env.VITE_APP_URL || "",
    APP_VERSION: packageJson.version
      ? `${packageJson.version}${mode === "development" ? "-DEV" : ""}`
      : "0.0.0",
    APP_DESCRIPTION: packageJson.description || "",
  };

  return {
    optimizeDeps: {
      exclude: ["@jsquash/avif", "wasm-media-encoders"],
    },
    plugins: [
      {
        name: "html-transform",
        transformIndexHtml: {
          order: "pre",
          handler: (html: string): string =>
            html.replace(/\{(.*?)\}/g, (match, key) => define[key] ?? match),
        },
      },
      svelte(),
    ],
    build: {
      emptyOutDir: true,
      rollupOptions: {
        input: {
          driver: resolve(import.meta.dirname, "driver.html"),
          passenger: resolve(import.meta.dirname, "index.html"),
        },
        output: {
          entryFileNames: "assets/[name].[hash].js",
          chunkFileNames: "assets/[name].[hash].js",
          assetFileNames: "assets/[name].[hash].[ext]",
        },
      },
    },
  };
});