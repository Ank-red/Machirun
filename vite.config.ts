import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'icon.png'],
      manifest: {
        name: 'Machirun - バス運行管理',
        short_name: 'Machirun',
        description: 'VRChat向け電子スターフ・バス運行管理車載器',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone', // ブラウザのUIを非表示にしてアプリ風にする
        start_url: '/driver.html', // 起動時に直接車載器画面を開く
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
  ],
  build: {
    rollupOptions: {
      input: {
        driver: resolve(import.meta.dirname, 'driver.html'),
        desktop: resolve(import.meta.dirname, 'desktop.html'),
        // passenger: resolve(import.meta.dirname, 'index.html'),
      }
    }
  }
});