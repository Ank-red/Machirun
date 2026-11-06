import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import packageJson from "./package.json" with { type: 'json' };
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const isTauri = process.env.TAURI_ENV_PLATFORM !== undefined || process.env.TAURI === 'true';
  process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };
  const define: Record<string, string> = {
    APP_TITLE: process.env.VITE_APP_TITLE ? process.env.VITE_APP_TITLE : "Unknown App Title",
    APP_SHORT_TITLE: process.env.VITE_APP_SHORT_TITLE ? process.env.VITE_APP_SHORT_TITLE : "UnknownApp",
    APP_URL: process.env.VITE_APP_URL ? process.env.VITE_APP_URL : "UnknownApp",
    APP_PROVIDER: process.env.VITE_APP_PROVIDER ? process.env.VITE_APP_PROVIDER : "Unknown App Provider",
    APP_PROVIDER_URL: process.env.VITE_APP_PROVIDER_URL ? process.env.VITE_APP_PROVIDER_URL : "",
    APP_PROVIDER_TWITTER: process.env.VITE_APP_PROVIDER_TWITTER ? process.env.VITE_APP_PROVIDER_TWITTER : "",
    APP_VERSION: packageJson.version ? packageJson.version + (mode === "development" ? "-DEV" : "") : "Unknown Version",
    APP_DESCRIPTION: packageJson.description ? packageJson.description : "",
    // APP_REPOSITORY_URL: packageJson.repository.url ? packageJson.repository.url.replace(/^git\+|\.git$/g, "") : "",
    // APP_REPOSITORY_NAME: packageJson.repository.url ? packageJson.repository.url.replace(/^git\+|\.git$/g, "").replace(/^https:\/\/github.com\/.*\//, "") : "",
  };
  return {
    plugins: [
      {
        name: "html-transform",
        transformIndexHtml: {
          order: "pre" as const,
          handler: (html: string): string =>
            html.replace(/{(.*?)}/g, (match, p1) =>
              define[p1] ?? match),
          optimizeDeps: { exclude: ["@jsquash/avif", "wasm-media-encoders"] }
        },
      },
      svelte(),
      !isTauri && VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: ['favicon.ico', 'icon.png'],
        workbox: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
        manifest: {
          name: define.APP_TITLE,
          short_name: define.APP_SHORT_TITLE,
          description: define.APP_DESCRIPTION,
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone', // ブラウザのUIを非表示にしてアプリ風にする
          start_url: '/index.html', // 起動時に直接車載器画面を開く
          lang: "ja",
          icons: [
            {
              src: '/icon.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        }
      })
    ].filter(Boolean),
    build: {
      minify: "terser",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          driver: resolve(import.meta.dirname, 'driver.html'),
          desktop: resolve(import.meta.dirname, 'desktop.html'),
          passenger: resolve(import.meta.dirname, 'index.html'),
        },
        output: {
          entryFileNames: 'assets/[name].[hash].js',
          chunkFileNames: 'assets/[name].[hash].js',
          assetFileNames: 'assets/[name].[hash].[ext]'
        }
      }
    }
  }
});