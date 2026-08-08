// トップ画面のアプリシェル。
// 全画面地図（MapView）を背景に敷き、出発地・目的地の入力 UI をオーバーレイで重ねる。
// 出発地と目的地が揃うと「ルート生成」CTA が押せ、素のルートを取得して地図に描画する。
// （寄り道スライダー・休憩設定 UI はステップ4/5 で追加する。）

import { useEffect, useMemo, useState } from 'react'
import type { Coord, SuggestItem } from '../server/types'
import { MapView } from './components/MapView'
import { RoutePanel } from './components/RoutePanel'
import { SuggestField } from './components/SuggestField'
import { useGeolocation } from './hooks/useGeolocation'
import { useRoutePlan } from './hooks/useRoutePlan'
import { readMapboxToken } from './lib/mapbox'

function App() {
  // token は SSR が window へ埋め込んだ値。マウント時に一度だけ読む。
  const token = useMemo(() => readMapboxToken(), [])

  const { coord: geoOrigin, status: geoStatus } = useGeolocation()

  // 出発地は現在地（geoOrigin）を既定にしつつ、候補選択で上書きもできる。
  const [originItem, setOriginItem] = useState<SuggestItem | null>(null)
  const [originQuery, setOriginQuery] = useState('')

  const [destItem, setDestItem] = useState<SuggestItem | null>(null)
  const [destQuery, setDestQuery] = useState('')

  const { plan, status: planStatus, error: planError, generate, reset } = useRoutePlan()

  // 実際に使う出発地座標: 手動選択があればそれ、なければ現在地。
  const origin: Coord = originItem?.coord ?? geoOrigin

  // 地図のフォーカス先: 目的地 > 手動出発地 > 現在地（取得成功時）。
  const focus: Coord | null =
    destItem?.coord ?? originItem?.coord ?? (geoStatus === 'success' ? geoOrigin : null)

  // 出発地・目的地が変わったら前回のルート結果を破棄する（古い線が残らないように）。
  useEffect(() => {
    reset()
  }, [origin, destItem, reset])

  function handleOriginChange(value: string) {
    setOriginQuery(value)
    if (originItem && value !== originItem.name) setOriginItem(null)
  }

  function handleDestChange(value: string) {
    setDestQuery(value)
    if (destItem && value !== destItem.name) setDestItem(null)
  }

  const canGenerate = destItem !== null && planStatus !== 'loading'

  function handleGenerate() {
    if (!destItem) return
    void generate(origin, destItem.coord)
  }

  const originPlaceholder =
    geoStatus === 'locating'
      ? '現在地を取得中…'
      : geoStatus === 'fallback'
        ? '現在地不明（東京駅）・検索で指定'
        : '現在地（変更する場合は検索）'

  return (
    <div className="map-shell">
      <MapView
        token={token}
        origin={origin}
        destination={destItem?.coord ?? null}
        focus={focus}
        route={plan?.route.geojson ?? null}
      />

      <div className="overlay">
        <header className="brand">
          <span className="brand__logo">Buraburider</span>
          <span className="brand__sub">ブラブライダー</span>
        </header>

        <section className="search-panel" aria-label="出発地・目的地の入力">
          <SuggestField
            label="出発"
            placeholder={originPlaceholder}
            query={originQuery}
            proximity={geoOrigin}
            selectedId={originItem?.id ?? null}
            onQueryChange={handleOriginChange}
            onSelect={(item) => {
              setOriginItem(item)
              setOriginQuery(item.name)
            }}
          />

          <SuggestField
            label="目的地"
            placeholder="行き先を検索"
            query={destQuery}
            proximity={origin}
            selectedId={destItem?.id ?? null}
            onQueryChange={handleDestChange}
            onSelect={(item) => {
              setDestItem(item)
              setDestQuery(item.name)
            }}
          />
        </section>

        <div className="bottom-dock">
          <RoutePanel plan={plan} status={planStatus} error={planError} />

          <button
            type="button"
            className="btn-generate"
            onClick={handleGenerate}
            disabled={!canGenerate}
          >
            {planStatus === 'loading' ? '生成中…' : 'ルート生成'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
