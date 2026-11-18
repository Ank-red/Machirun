import "beercss";
import "material-dynamic-colors";
import "./main.scss";
import { mount } from "svelte";
import DriverApp from "./Driver.svelte";

ui("mode", "dark");
await ui("theme", "#106f10");

/** 車載器・エディタアプリケーションのマウントインスタンス */
const app = mount(DriverApp, {
  target: document.getElementById("app")!,
});

export default app;