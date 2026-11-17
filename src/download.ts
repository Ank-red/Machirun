import "beercss";
import "material-dynamic-colors";
import "./main.scss";
import { mount } from "svelte";
import DownloadView from "./Download.svelte";

ui("mode", "auto");
await ui("theme", "#106f10");

/** ダウンロードおよび仕様書ページのマウントインスタンス */
const app = mount(DownloadView, {
  target: document.getElementById("app")!,
});

export default app;