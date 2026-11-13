/// <reference types="svelte" />
/// <reference types="vite/client" />

import type { CommitEntry } from "./core/types";

declare global {
  const __APP_TITLE__: string;
  const __APP_VERSION__: string;
  const __APP_HOMEPAGE__: string;
  const __APP_DESCRIPTION__: string;
  const __APP_AUTHOR_NAME__: string;
  const __APP_AUTHOR_URL__: string;
  const __APP_REPOSITORY_URL__: string;
  const __APP_CHANGELOG__: CommitEntry[];
}