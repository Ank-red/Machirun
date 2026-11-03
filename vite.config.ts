import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
  plugins: [svelte()],
  build: {
    rollupOptions: {
      input: {
        driver: resolve(import.meta.dirname, 'driver.html'),
        // passenger: resolve(import.meta.dirname, 'index.html'),
      }
    }
  }
});