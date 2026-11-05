import "beercss";
import './main.scss'
import { mount } from 'svelte';
import PassengerApp from './PassengerApp.svelte';

const app = mount(PassengerApp, {
  target: document.getElementById('app')!
});

export default app;