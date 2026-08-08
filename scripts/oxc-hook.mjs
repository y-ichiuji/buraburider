#!/usr/bin/env node
// Claude Code の PostToolUse hook 用スクリプト。
// Edit / Write / MultiEdit で変更されたファイルに対して、
// oxfmt（フォーマット・in-place 書き換え）→ oxlint（静的解析）を順に実行する。
//
// stdin から hook のペイロード（JSON）を受け取り、tool_input.file_path を対象にする。
// oxlint がエラーを検出した場合は exit code 2 で終了し、その内容を Claude に通知する。
import { spawnSync } from 'node:child_process'

const TARGET_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/
const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()

function readStdin() {
  return new Promise((resolve) => {
    let raw = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      raw += chunk
    })
    process.stdin.on('end', () => resolve(raw))
    process.stdin.on('error', () => resolve(raw))
  })
}

const raw = await readStdin()

let filePath
try {
  filePath = JSON.parse(raw)?.tool_input?.file_path
} catch {
  // ペイロードが解釈できない場合は何もしない。
  process.exit(0)
}

// 対象外のファイル（CSS や Markdown など）はスキップする。
if (!filePath || !TARGET_EXT.test(filePath)) {
  process.exit(0)
}

// 1. oxfmt でフォーマット（デフォルトで in-place 書き換え）。
const fmt = spawnSync('npx', ['oxfmt', filePath], { cwd, encoding: 'utf8' })
if (fmt.stdout) process.stderr.write(fmt.stdout)
if (fmt.stderr) process.stderr.write(fmt.stderr)

// 2. oxlint で静的解析。
const lint = spawnSync('npx', ['oxlint', filePath], { cwd, encoding: 'utf8' })
if (lint.stdout) process.stderr.write(lint.stdout)
if (lint.stderr) process.stderr.write(lint.stderr)

if (lint.status !== 0) {
  process.stderr.write(`\noxlint がエラーを検出しました: ${filePath}\n修正を検討してください。\n`)
  process.exit(2)
}

process.exit(0)
