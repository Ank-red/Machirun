import "beercss";
import "material-dynamic-colors";
import "./main.scss";
import { mount } from "svelte";
import PassengerApp from "./PassengerApp.svelte";

ui("mode", "auto");
await ui("theme", "#106f10");

/** 乗客向け案内アプリケーションのマウントインスタンス */
const app = mount(PassengerApp, {
  target: document.getElementById("app")!,
});

export default app;