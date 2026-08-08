// トップ画面のアプリシェル。
// 全画面地図（MapView）を背景に敷き、出発地・目的地の入力 UI をオーバーレイで重ねる。
// 出発地と目的地が揃うと「ルート生成」CTA が押せ、素のルートを取得して地図に描画する。
// （寄り道スライダー・休憩設定 UI はステップ4/5 で追加する。）

import { useEffect, useMemo, useState } from 'react'
import type { Coord, RestConfig, SuggestItem } from '../server/types'
import { DetourSlider, detourLevelLabel } from './components/DetourSlider'
import { MapView } from './components/MapView'
import { RestSettings } from './components/RestSettings'
import { RoutePanel } from './components/RoutePanel'
import { SosButton } from './components/SosButton'
import { SuggestField } from './components/SuggestField'
import { useGeolocation } from './hooks/useGeolocation'
import { useRoutePlan } from './hooks/useRoutePlan'
import { DEFAULT_DETOUR_LEVEL, DEFAULT_REST_CONFIG } from './lib/plan'
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

  // 寄り道度（0-5）。ルート生成時に buildPlanRequest 経由でサーバーへ送る。
  const [detourLevel, setDetourLevel] = useState(DEFAULT_DETOUR_LEVEL)

  // 休憩設定（ON/OFF・間隔・モード）。RestSettings で編集し生成時に送る。
  const [rest, setRest] = useState<RestConfig>(DEFAULT_REST_CONFIG)

  const { plan, status: planStatus, error: planError, generate, reset } = useRoutePlan()

  // 走行設定（寄り道・休憩）の開閉。増えたコントロールで下部が伸びるため、
  // 生成前は設定を開いて主役にし、生成後は結果を主役にするため畳む（手動再開閉も可）。
  const [settingsOpen, setSettingsOpen] = useState(true)
  const hasPlan = plan !== null
  useEffect(() => {
    setSettingsOpen(!hasPlan)
  }, [hasPlan])

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
    void generate(origin, destItem.coord, detourLevel, rest)
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
        waypoints={plan?.waypoints ?? []}
        rests={plan?.rests ?? []}
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

          <section className="settings-group" data-open={settingsOpen ? 'true' : undefined}>
            <button
              type="button"
              className="settings-group__toggle"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <span className="settings-group__title">走行設定</span>
              <span className="settings-group__summary">
                {`${detourLevelLabel(detourLevel)}・${
                  rest.enabled ? `休憩${rest.intervalMinutes}分` : '休憩なし'
                }`}
              </span>
              <span className="settings-group__chevron" aria-hidden="true">
                ▾
              </span>
            </button>

            {settingsOpen && (
              <div className="settings-group__body">
                <DetourSlider
                  value={detourLevel}
                  onChange={setDetourLevel}
                  disabled={planStatus === 'loading'}
                />

                <RestSettings value={rest} onChange={setRest} disabled={planStatus === 'loading'} />
              </div>
            )}
          </section>

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

      <SosButton />
    </div>
  )
}

export default App
