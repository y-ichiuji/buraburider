import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// テストは2系統を1回の `npm test`（vitest run）で両方実行する（Vitest の projects 構成）。
//
// - server: サーバー / Durable Object / 共有ロジック。`@cloudflare/vitest-pool-workers` の
//   Workers ランタイム上で実行する。本番 wrangler.jsonc の AI バインディングをそのまま読むと
//   プール起動時にリモート接続が張られ、遅延・ネットワーク依存・プロセス残留（close timed out）
//   を招くため、AI を除いた wrangler.vitest.jsonc を参照する。D1 / DO / KV は miniflare が
//   ローカル模擬する。cloudflareTest プラグインは configureVitest でこのプロジェクトだけに
//   Workers プールを適用するため、client プロジェクトには影響しない。
// - client: React コンポーネント / フック / 純粋関数。Workers プールは DOM 描画に不向きなので、
//   happy-dom 環境 + Testing Library で実行する（cloudflareTest プラグインは適用しない）。
export default defineConfig({
  test: {
    projects: [
      {
        // server プロジェクト: Workers ランタイム（vitest-pool-workers）。
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.vitest.jsonc' }
          })
        ],
        test: {
          name: 'server',
          include: ['src/server/**/*.test.ts', 'src/agents/**/*.test.ts', 'src/shared/**/*.test.ts']
        }
      },
      {
        // client プロジェクト: happy-dom + Testing Library（DOM 環境）。
        plugins: [react()],
        test: {
          name: 'client',
          environment: 'happy-dom',
          globals: true,
          setupFiles: ['./test/client-setup.ts'],
          include: ['src/client/**/*.test.{ts,tsx}']
        }
      }
    ]
  }
})
