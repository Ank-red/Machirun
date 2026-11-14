#### `README/CODING_STANDARDS.md`

# Machirun コーディング規約

本プロジェクトにおけるコード品質・一貫性・保守性を維持するための規約を定める。

## 1. ディレクトリ構成と責務の分離

階層が深くなることを避け、`src/` 直下は最大1階層のサブディレクトリで管理する。

- `src/core/`: ドメイン型定義 (`types.ts`) およびビジネスロジック・外部連携を担うサービスクラス群。UIフレームワーク（Svelteコンポーネント）に依存しない純粋な処理を配置する。
- `src/components/`: 複数の画面で再利用される汎用UIパーツ（ボタン、ドロップダウン、ヘッダー、LCDスクリーン等）。
- `src/views/`: 画面（ページ）単位のSvelteコンポーネント（車載器画面、エディタ画面、ソフトウェア情報画面等）。
- `src/`: アプリケーションのルートコンポーネントおよびエントリーポイント。

## 2. TypeScript・クラス設計・最新記法

- **サービスクラス化**: 関連するデータ操作・変換・再生・通信処理は用途ごとにクラス（`PresetService`, `TimetableService`, `ArchiveService`, `AudioPlayerService`, `LcdSyncService`）へ集約し、Svelteファイル内にロジックが散乱するのを防ぐ。
- **Svelte 5 Runes 準拠**: 状態管理には `$state`, `$derived`, `$derived.by`, `$effect`, `$props`, `$bindable` を使用する。Proxyオブジェクトのシリアライズやディープコピーには `$state.snapshot()` および `structuredClone()` を用いる。
- **命名と構造の統一**:
  - 類似する処理（アセットの追加 `register*`、差し替え `replace*`、削除 `remove*` など）は同一の命名規則・引数順序・エラーハンドリング構造で統一する。
  - 将来使用予定の定数（`BroadcastChannel` 名など）は削除せず明示的に保持する。

## 3. ドキュメンテーション (JSDoc)

- 全てのクラス、メソッド、関数、および重要な定数・インターフェースには必ず JSDoc (`/** ... */`) を記述する。
- 関数内部のインラインコメントは、処理の意図や制約を補足する上で真に必要な箇所にのみ絞る。
- Svelteファイル内のスクリプトおよびマークアップは、責務ごとのセクションコメントで区切る。

## 4. CSS・スタイリング規約

- **アルファベット順ソート**: 全てのCSSプロパティ（Svelteの `<style>` ブロック、`scss` ファイル、インラインテンプレート等）はアルファベット順（A→Z）で記述する。これは `stylelint-order` によって自動検証される。
- **レイアウト**: グリッドやフレックスボックス内のテキスト省略 (`text-overflow: ellipsis`) を正しく機能させるため、可変幅コンテナには `min-width: 0` を適切に付与する。

## 5. 設定ファイルとLinter運用

- プロジェクトルートの設定ファイル乱立を防ぐため、`tsconfig.json` は単一ファイルに統合し、Biome (`biome`) および Stylelint (`stylelint`) のルール定義は `package.json` 内に統合する。
- コミット前に `bun run check` および `bun run lint` がエラーなく通過することを必須とする。
