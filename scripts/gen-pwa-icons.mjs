// PWA アイコンを生成するスクリプト。
//
// ソース画像 assets/icon-source.jpeg（黒×オレンジのバイク＋ルート＋コンパス）から、
// macOS 標準の `sips` で各サイズの PNG を public/icons/ に書き出す。
//
//   node scripts/gen-pwa-icons.mjs
//
// 注意: `sips` は macOS 専用ツール。別環境で再生成する場合は同等のリサイズに置き換えること。
// 生成物（public/icons/*.png）はリポジトリにコミットしているため、通常は再実行不要。

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'assets', 'icon-source.jpeg')
const outDir = join(root, 'public', 'icons')

/** 背景色（デザイントークン --bg）。maskable の余白パディングに使う。 */
const BG = '0a0a0b'

function sips(args) {
  execFileSync('sips', args, { stdio: 'ignore' })
}

/** ソースを size×size の PNG にリサイズして out へ書き出す。 */
function resize(size, out) {
  sips(['-s', 'format', 'png', '-z', String(size), String(size), src, '--out', join(outDir, out)])
}

/**
 * maskable 用: セーフゾーン（内側約 80%）に収まるよう縮小し、周囲を背景色でパディングして
 * size×size にする。丸／角丸クロップされても主要素が欠けないようにする。
 */
function maskable(size, out) {
  const inner = Math.round(size * 0.8)
  const tmp = join(outDir, '_tmp-maskable.png')
  sips(['-s', 'format', 'png', '-z', String(inner), String(inner), src, '--out', tmp])
  sips([
    '--padToHeightWidth',
    String(size),
    String(size),
    '--padColor',
    BG,
    tmp,
    '--out',
    join(outDir, out)
  ])
  execFileSync('rm', ['-f', tmp], { stdio: 'ignore' })
}

resize(512, 'icon-512.png')
resize(192, 'icon-192.png')
resize(180, 'apple-touch-icon.png')
resize(32, 'favicon-32.png')
maskable(512, 'maskable-512.png')

console.log('PWA アイコンを public/icons/ に生成しました。')
