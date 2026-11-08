import "beercss";
import "material-dynamic-colors";
import './main.scss'
import { mount } from 'svelte';
import DriverApp from './DriverApp.svelte';

ui("mode", "dark");
await ui("theme", "#106f10");

// src/driver.ts の mount 直前に追加
if ("__TAURI_INTERNALS__" in window && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const reg of registrations) {
      reg.unregister();
    }
  });
  if ("caches" in window) {
    caches.keys().then((keys) => {
      for (const key of keys) {
        caches.delete(key);
      }
    });
  }
}

const app = mount(DriverApp, {
  target: document.getElementById('app')!
});


export default app;