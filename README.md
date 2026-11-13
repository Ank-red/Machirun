# Machirun (まちるん)

町林市バス 車載器システム・停留所エディタおよび案内表示アプリケーション。

## ドキュメント

- [コーディング規約 (Coding Standards)](./README/CODING_STANDARDS.md)

## 開発コマンド

```bash
# 依存パッケージのインストール
bun install

# 開発サーバー起動 (Web)
bun run dev

# デスクトップアプリ開発起動 (Tauri)
bunx tauri dev

# 型チェック & リント (ESLint / Stylelint)
bun run check
bun run lint

# AIコンテキスト用Markdown出力
bun run context
```
