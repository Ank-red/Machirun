/// <reference types="svelte" />
/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_DESCRIPTION__: string;
declare const __APP_CHANGELOG__: {
  hash: string;
  date: string;
  subject: string;
  versionTag?: string;
}[];