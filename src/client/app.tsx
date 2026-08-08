// トップ画面のアプリシェル。
// 全画面地図（MapView）を背景に敷き、出発地・目的地の入力 UI をオーバーレイで重ねる。
// この段階ではルート生成は未実装（ステップ 3 以降）。目的地が選べて地図が動くところまで。

import { useMemo, useState } from 'react'
import type { Coord, SuggestItem } from '../server/types'
import { MapView } from './components/MapView'
import { SuggestField } from './components/SuggestField'
import { useGeolocation } from './hooks/useGeolocation'
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

  // 実際に使う出発地座標: 手動選択があればそれ、なければ現在地。
  const origin: Coord = originItem?.coord ?? geoOrigin

  // 地図のフォーカス先: 目的地 > 手動出発地 > 現在地（取得成功時）。
  const focus: Coord | null =
    destItem?.coord ?? originItem?.coord ?? (geoStatus === 'success' ? geoOrigin : null)

  function handleOriginChange(value: string) {
    setOriginQuery(value)
    if (originItem && value !== originItem.name) setOriginItem(null)
  }

  function handleDestChange(value: string) {
    setDestQuery(value)
    if (destItem && value !== destItem.name) setDestItem(null)
  }

  const originPlaceholder =
    geoStatus === 'locating'
      ? '現在地を取得中…'
      : geoStatus === 'fallback'
        ? '現在地不明（東京駅）・検索で指定'
        : '現在地（変更する場合は検索）'

  return (
    <div className="map-shell">
      <MapView token={token} origin={origin} destination={destItem?.coord ?? null} focus={focus} />

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
      </div>
    </div>
  )
}

export default App
