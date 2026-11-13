/// <reference types="svelte" />
/// <reference types="vite/client" />

declare const __APP_TITLE__: string;
declare const __APP_VERSION__: string;
declare const __APP_HOMEPAGE__: string;
declare const __APP_DESCRIPTION__: string;
declare const __APP_AUTHOR_NAME__: string;
declare const __APP_AUTHOR_URL__: string;
declare const __APP_REPOSITORY_URL__: string;
declare const __APP_CHANGELOG__: {
  hash: string;
  date: string;
  subject: string;
  versionTag?: string;
}[];