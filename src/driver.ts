import "beercss";
import "material-dynamic-colors";
import "./main.scss";
import { mount } from "svelte";
import DriverApp from "./DriverApp.svelte";

ui("mode", "dark");
await ui("theme", "#106f10");

const app = mount(DriverApp, {
  target: document.getElementById("app")!,
});

export default app;