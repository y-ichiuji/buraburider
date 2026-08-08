// 「道の駅」データの取得精度を検証するスクリプト。
//
// OpenStreetMap（Overpass API・トークン不要）を正解データの基準とし、
// 同じ道の駅を Mapbox Search Box API がどれだけ拾えるか（カバー率）を測定する。
// これにより「Mapbox 単独で道の駅レイヤーを賄えるか / OSM 補完が必要か」を判断する。
//
// 使い方:
//   1. .dev.vars に MAPBOX_SECRET_TOKEN=pk.xxxx を記載する
//   2. node scripts/verify-michinoeki.mjs
//
// 既定のテスト対象は山梨県周辺（ワインディング・道の駅が多いエリア）。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// --- 設定 --------------------------------------------------------------

// テスト対象の矩形領域 [南緯, 西経, 北緯, 東経]（山梨県周辺）
const BBOX = [35.15, 138.2, 35.95, 139.15]

// OSM の道の駅座標から、この距離(m)以内に Mapbox の結果があれば「一致」とみなす
const MATCH_RADIUS_M = 500

// Mapbox 呼び出し間の待機(ms)。レート制限に配慮する
const CALL_INTERVAL_MS = 150

// --- トークン読み込み --------------------------------------------------

function loadToken() {
  if (process.env.MAPBOX_SECRET_TOKEN) return process.env.MAPBOX_SECRET_TOKEN
  try {
    const text = readFileSync(join(__dirname, '..', '.dev.vars'), 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*MAPBOX_SECRET_TOKEN\s*=\s*(.+?)\s*$/)
      if (m) return m[1].replace(/^["']|["']$/g, '')
    }
  } catch {
    // .dev.vars が無い場合は下でエラーにする
  }
  return null
}

// --- ユーティリティ ----------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 2点間の距離(m)をハバーサインで概算
function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// --- OSM（基準データ）取得 ---------------------------------------------

// 公開 Overpass サーバーは混雑で 504 を返すことがあるため、複数ミラーを順に試す
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
]

async function fetchOsmMichinoeki() {
  const [s, w, n, e] = BBOX
  const query = `[out:json][timeout:120];node["name"~"道の駅"](${s},${w},${n},${e});out center;`

  let lastError
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`  Overpass 試行: ${endpoint} (${attempt}回目)`)
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'yorimichi-hackathon/1.0 (michinoeki coverage check)',
            Accept: 'application/json'
          },
          body: 'data=' + encodeURIComponent(query)
        })
        if (!res.ok) {
          lastError = new Error(`${res.status} (${endpoint})`)
          // サーバー混雑(504/429/503)なら少し待って次へ
          await sleep(2000)
          continue
        }
        const json = await res.json()
        return json.elements
          .filter((el) => el.lat != null && el.lon != null)
          .map((el) => ({ name: el.tags?.name ?? '(名称なし)', lat: el.lat, lon: el.lon }))
      } catch (err) {
        lastError = err
        await sleep(2000)
      }
    }
  }
  throw new Error(`全ての Overpass サーバーで失敗しました: ${lastError?.message}`)
}

// --- Mapbox 検索 -------------------------------------------------------

async function searchMapbox(name, lat, lon, token) {
  const url = new URL('https://api.mapbox.com/search/searchbox/v1/forward')
  url.searchParams.set('q', name)
  url.searchParams.set('proximity', `${lon},${lat}`)
  url.searchParams.set('language', 'ja')
  url.searchParams.set('country', 'jp')
  url.searchParams.set('limit', '5')
  url.searchParams.set('access_token', token)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Mapbox Search Box error: ${res.status} ${await res.text()}`)
  const json = await res.json()
  return json.features ?? []
}

// OSM の1件について、Mapbox が MATCH_RADIUS_M 以内に返すかを判定
function isCovered(osm, features) {
  for (const f of features) {
    const coords = f.geometry?.coordinates
    if (!coords) continue
    const [flon, flat] = coords
    if (distanceM(osm.lat, osm.lon, flat, flon) <= MATCH_RADIUS_M) return true
  }
  return false
}

// --- メイン ------------------------------------------------------------

async function main() {
  const token = loadToken()
  if (!token) {
    console.error('❌ MAPBOX_SECRET_TOKEN が見つかりません。.dev.vars に記載してください。')
    process.exit(1)
  }

  console.log(`テスト領域(BBox): ${JSON.stringify(BBOX)}`)
  console.log('OSM(Overpass) から道の駅を取得中...')
  const osmList = await fetchOsmMichinoeki()
  console.log(`OSM 基準件数: ${osmList.length} 件\n`)

  if (osmList.length === 0) {
    console.log('OSM で道の駅が見つかりませんでした。BBox を広げて再実行してください。')
    return
  }

  const covered = []
  const missed = []

  for (const [i, osm] of osmList.entries()) {
    try {
      const features = await searchMapbox(osm.name, osm.lat, osm.lon, token)
      if (isCovered(osm, features)) covered.push(osm)
      else missed.push(osm)
    } catch (err) {
      console.error(`  検索失敗: ${osm.name} — ${err.message}`)
      missed.push(osm)
    }
    process.stdout.write(`\r検証中... ${i + 1}/${osmList.length}`)
    await sleep(CALL_INTERVAL_MS)
  }
  process.stdout.write('\n\n')

  const rate = ((covered.length / osmList.length) * 100).toFixed(1)
  console.log('==================== 結果 ====================')
  console.log(`OSM 基準件数     : ${osmList.length}`)
  console.log(`Mapbox 一致件数  : ${covered.length}`)
  console.log(`カバー率         : ${rate}%`)
  console.log('=============================================\n')

  if (missed.length > 0) {
    console.log('Mapbox が拾えなかった道の駅:')
    for (const m of missed) console.log(`  - ${m.name} (${m.lat}, ${m.lon})`)
    console.log('')
  }

  console.log('判断の目安:')
  console.log('  8割以上   → Mapbox 単独で道の駅レイヤーを賄える')
  console.log(
    '  半分前後  → OSM を主データにし、Mapbox はルート計算・地図描画に専念（推奨フォールバック）'
  )
  console.log('  ほぼ無し  → 道の駅レイヤーは OSM/Overpass、Mapbox は地図/Directions のみ')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
