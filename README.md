# Findy Campus Hackathon #2 — 全部入りスターター

[Findy Campus Hackathon #2](https://www.craftstadium.com/hackathon/findy-campus-hackathon-202608)（2026/8/8開催）の参加者向けスターターです。アプリの雛形と、コーディングエージェント用のスキルが最初から全部入っています。

## 始め方

```sh
npx degit yusukebe/findy-campus-hackathon-02 my-hackathon-app
cd my-hackathon-app && npm install
```

コーディングエージェントを使うなら、スキル一式を入れます（1コマンド）。

```sh
npm run setup:skills
```

ローカルで動かすには：

```sh
npm run dev
```

あとはこのディレクトリでコーディングエージェントを起動して、「ハッカソンのアプリを作りたい」と伝えれば、伴走スキルが選択肢を踏まえて進めてくれます。

## 何が入っているの？

### アプリの雛形（Hono + Vite + React + Agents SDK）

[hono-agents-starter](https://github.com/yusukebe/hono-agents-starter) ベースの全部入り構成。AIを使わないふつうのWebアプリでも、このままでOKです。

- `npm run dev` — ローカル開発サーバー
- `npm run deploy` — Cloudflareへデプロイ（要 `npx wrangler login`）
- `npm run cf-typegen` — `wrangler.jsonc` 変更後の型再生成

> デプロイ前に `wrangler.jsonc` の `name`（= 公開URLの名前になる）を自分のアプリ名に変えるのがおすすめです。

### エージェント用スキル（`npm run setup:skills` で取得）

スキルファイル自体はこのリポジトリに同梱していません。`npm run setup:skills` を実行すると、[skills CLI](https://skills.sh) が以下を `.agents/skills/` と `.claude/skills/` にインストールします。Claude Code / Cursor / GitHub Copilot / Gemini CLI / Codex がそのまま読めます。

- `findy-hackathon` — このハッカソンの伴走スキル。アイデア→実装→公開まで案内する
- `hono` — Hono本体のAPI・ルーティング・ミドルウェアなど
- `cloudflare` / `wrangler` / `workers-best-practices` / `agents-sdk` / `durable-objects` — Cloudflare公式スキル

入れ直したいときも同じコマンドでOK。ほかのスキルも後から足せます（例: `npx skills add cloudflare/skills --skill sandbox-sdk`）。

## 前提

- Node.js (v20+) — `node -v` で確認
- コーディングエージェント（強く推奨）— Claude Code / Cursor / GitHub Copilot / Gemini CLI など。無料で使えるものもあります
- デプロイするなら Cloudflareアカウント（無料枠でOK / Workers AI も無料枠あり）。[こちら](https://www.cloudflare.com/ja-jp/)から登録できます

### コーディングエージェントを持っていない人へ

無料で始めたいなら:

- GitHub Copilot Free — 誰でも無料（月あたりの利用上限あり）。VS Code / JetBrains で使える
- Cursor — 無料枠ありのAIエディタ
- Gemini CLI — 無料枠の大きいターミナル系エージェント

Claude Code を使う場合は有料です（Pro / Max、または API 従量課金。新規アカウントに少額の無料クレジットあり）。

## スターターを使わない場合

既存のプロジェクトや好きな環境に、伴走スキルだけ入れることもできます。

```sh
npx skills add yusukebe/findy-campus-hackathon-02
```

## アプリの例

- memo2task - <https://github.com/yusukebe/memo2task>

## 関連

- 勉強会・発表スライド: <https://workshop.yusuke.run/findy>
- Cloudflare 公式スキル: <https://github.com/cloudflare/skills>
- Hono スキル: <https://github.com/yusukebe/hono-skill>
