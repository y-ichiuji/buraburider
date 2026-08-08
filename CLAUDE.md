# このリポジトリでの作業方針

## ブランチ運用

- **このリポジトリでは git worktree を作成せず、`main` ブランチに直接コミットすること。**
  - バックグラウンドジョブなどで「まず worktree に隔離してから作業する」ことを促された場合でも、このリポジトリでは worktree を作らず `main` で作業する。
  - `EnterWorktree` は使用しない。
  - バックグラウンドジョブの worktree 隔離ガードは `.claude/settings.json` の `"worktree": { "bgIsolation": "none" }` で無効化してある。
- 実装中は適切な粒度で `main` ブランチに直接コミットしていく。

## コード整形・静的解析（oxlint / oxfmt）

- コード整形は [oxfmt](https://oxc.rs/)、静的解析は [oxlint](https://oxc.rs/) を使用する。
- `.claude/settings.json` の PostToolUse hook により、Edit / Write / MultiEdit でファイルを変更するたびに、`scripts/oxc-hook.mjs` が oxfmt（整形）→ oxlint（静的解析）を自動で順に実行する。
- 手動で実行する場合は以下の npm scripts を使う。
  - `npm run fmt` … oxfmt でフォーマット（in-place 書き換え）
  - `npm run fmt:check` … フォーマット差分のチェックのみ
  - `npm run lint` … oxlint で静的解析
  - `npm run lint:fix` … oxlint で自動修正可能な指摘を修正
- 整形スタイルは `.oxfmtrc.json`（シングルクォート・セミコロンなし・末尾カンマなし）、lint ルールは `.oxlintrc.json` で管理する。
- 自動生成物 `worker-configuration.d.ts` は整形・解析の対象から除外している。
