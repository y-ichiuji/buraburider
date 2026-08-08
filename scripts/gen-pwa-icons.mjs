// PWA アイコン生成スクリプト（外部画像を取得せずリポジトリ内で完結する）。
//
// ブランド（黒 #0a0a0b × オレンジ #ff6a00）のナビゲーション矢印モチーフを、
// SVG 由来の同一ポリゴンからラスタライズして PNG を書き出す。外部依存なし
// （Node 標準の zlib のみ）で、CI やオフラインでも再生成できる。
//
// 出力（public/icons/）:
//   - icon-192.png / icon-512.png … 通常アイコン（角丸・purpose: any）
//   - maskable-512.png            … maskable（フルブリード・セーフゾーン内にモチーフ）
//   - apple-touch-icon.png (180)  … iOS ホーム画面用（不透明正方形。丸めは iOS 側）
//   - icon.svg                    … 同一モチーフのベクター原本（参照・任意利用）
//
// 実行: `node scripts/gen-pwa-icons.mjs`

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'icons')

const BG = [10, 10, 11] // --bg #0a0a0b
const ORANGE = [255, 106, 0] // --primary #ff6a00

// ナビゲーション矢印（上向き）を単位座標 [0,1]（y は下向き）で定義する。
// 中央下に切り欠きを持つ、地図ナビでおなじみの「現在地／進行方向」矢印。
const ARROW = [
  [0.5, 0.14],
  [0.82, 0.86],
  [0.5, 0.66],
  [0.18, 0.86]
]

function pointInPolygon(px, py, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]
    const yi = poly[i][1]
    const xj = poly[j][0]
    const yj = poly[j][1]
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function scalePoly(poly, scale) {
  return poly.map(([x, y]) => [0.5 + (x - 0.5) * scale, 0.5 + (y - 0.5) * scale])
}

// 角丸正方形の内側判定（単位座標・角丸半径 radius）。radius=0 でフル正方形。
function inRoundedRect(x, y, radius) {
  const rx = Math.min(Math.max(x, radius), 1 - radius)
  const ry = Math.min(Math.max(y, radius), 1 - radius)
  const dx = x - rx
  const dy = y - ry
  return dx * dx + dy * dy <= radius * radius
}

// スーパーサンプリングで矢印・角丸のエッジをなめらかにしつつ RGBA バッファを作る。
function renderRgba(size, { radius, arrowScale }) {
  const arrow = scalePoly(ARROW, arrowScale)
  const ss = 4
  const samples = ss * ss
  const data = Buffer.alloc(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rAcc = 0
      let gAcc = 0
      let bAcc = 0
      let aAcc = 0 // 不透明サンプル数 × 255

      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const ux = (x + (sx + 0.5) / ss) / size
          const uy = (y + (sy + 0.5) / ss) / size
          if (!inRoundedRect(ux, uy, radius)) continue
          const color = pointInPolygon(ux, uy, arrow) ? ORANGE : BG
          rAcc += color[0]
          gAcc += color[1]
          bAcc += color[2]
          aAcc += 255
        }
      }

      const idx = (y * size + x) * 4
      const outA = Math.round(aAcc / samples)
      if (aAcc > 0) {
        // ストレートアルファ: 不透明サンプルの平均色を採用する。
        data[idx] = Math.round((rAcc * 255) / aAcc)
        data[idx + 1] = Math.round((gAcc * 255) / aAcc)
        data[idx + 2] = Math.round((bAcc * 255) / aAcc)
      }
      data[idx + 3] = outA
    }
  }
  return data
}

let CRC_TABLE
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'latin1')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(size, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  const stride = size * 4
  const rawWithFilters = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    rawWithFilters[y * (stride + 1)] = 0 // filter: none
    rgba.copy(rawWithFilters, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(rawWithFilters, { level: 9 })
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function writePng(name, size, opts) {
  const rgba = renderRgba(size, opts)
  writeFileSync(join(OUT_DIR, name), encodePng(size, rgba))
}

function svgSource() {
  const pts = ARROW.map(([x, y]) => `${Math.round(x * 512)} ${Math.round(y * 512)}`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Buraburider">
  <rect width="512" height="512" rx="92" fill="#0a0a0b"/>
  <path d="M${pts[0]} L${pts[1]} L${pts[2]} L${pts[3]} Z" fill="#ff6a00"/>
</svg>
`
}

mkdirSync(OUT_DIR, { recursive: true })
// 通常アイコン: 角丸・モチーフ大きめ。
writePng('icon-192.png', 192, { radius: 0.18, arrowScale: 0.82 })
writePng('icon-512.png', 512, { radius: 0.18, arrowScale: 0.82 })
// maskable: フルブリード（角丸なし）・セーフゾーン内に収まるよう縮小。
writePng('maskable-512.png', 512, { radius: 0, arrowScale: 0.66 })
// iOS ホーム画面: 不透明正方形（丸めは iOS 側）。
writePng('apple-touch-icon.png', 180, { radius: 0, arrowScale: 0.72 })
writeFileSync(join(OUT_DIR, 'icon.svg'), svgSource())

process.stdout.write('PWA icons generated in public/icons/\n')
