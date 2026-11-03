import { mount } from 'svelte';
import DriverApp from './DriverApp.svelte';

const app = mount(DriverApp, {
  target: document.getElementById('app')!
});

export default app;