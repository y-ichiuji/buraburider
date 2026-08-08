// SOS ボタン（機能④の土台）。
//
// ナビ画面の端に透過の大サイズで常時固定する（設計 §8 / design-system §4）。誤作動防止のため
// タップでは発動せず、「スワイプ」または「1秒長押し」で発動する（グローブ操作想定）。ジェスチャ
// 判定は ../lib/sos.ts の純粋関数に切り出してテスト済み。ここではその判定に PointerEvent を
// 接続する。
//
// この段階は土台: 発動したら選択カテゴリ（トイレ / GS / 雨宿り）を視覚フィードバックするに留め、
// 「タイムロス最少の1発自動挿入」や SOS 後の自動復帰は実装しない（ステップ7/将来）。

import { useCallback, useRef, useState } from 'react'
import type { Point, SosCategory } from '../lib/sos'
import { evaluateSosGesture, SOS_CATEGORIES, SOS_LONG_PRESS_MS } from '../lib/sos'

/** idle=待機 / pressing=押下中（判定待ち） / armed=発動しカテゴリ選択中。 */
type Phase = 'idle' | 'pressing' | 'armed'

export function SosButton() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [selected, setSelected] = useState<SosCategory | null>(null)

  const startRef = useRef<Point | null>(null)
  const startAtRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const activatedRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // スワイプ / 長押しのいずれかが成立したら発動する（多重発動は activatedRef でガード）。
  const arm = useCallback(() => {
    if (activatedRef.current) return
    activatedRef.current = true
    clearTimer()
    startRef.current = null
    setSelected(null)
    setPhase('armed')
  }, [clearTimer])

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (phase === 'armed') return
    activatedRef.current = false
    startRef.current = { x: event.clientX, y: event.clientY }
    startAtRef.current = performance.now()
    setPhase('pressing')
    event.currentTarget.setPointerCapture(event.pointerId)
    clearTimer()
    // 動かず 1 秒保持したケース（長押し）はタイマーで拾う。スワイプは move で拾う。
    timerRef.current = window.setTimeout(arm, SOS_LONG_PRESS_MS)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (activatedRef.current || startRef.current === null) return
    const trigger = evaluateSosGesture({
      start: startRef.current,
      current: { x: event.clientX, y: event.clientY },
      heldMs: performance.now() - startAtRef.current
    })
    if (trigger !== null) arm()
  }

  function handlePointerEnd() {
    clearTimer()
    startRef.current = null
    // 発動前に指を離した = 誤タップ扱いで何もしない（待機へ戻す）。
    if (!activatedRef.current) setPhase('idle')
  }

  function handleSelect(category: SosCategory) {
    setSelected(category)
    // TODO(ステップ7/将来): 選択カテゴリの searchCategory（SOS_CATEGORIES 参照）で
    // searchCategory() 近傍検索 → タイムロス最少の1発自動挿入 → SOS 後の自動復帰へつなぐ。
    // 現段階は視覚フィードバックのみ（近傍スポット自動挿入は未実装）。
  }

  function handleClose() {
    activatedRef.current = false
    setSelected(null)
    setPhase('idle')
  }

  const selectedMeta =
    selected === null ? null : (SOS_CATEGORIES.find((c) => c.category === selected) ?? null)

  return (
    <div className="sos" data-phase={phase}>
      {phase === 'armed' && (
        <div className="sos__sheet" role="dialog" aria-label="SOS 緊急アクション">
          <div className="sos__sheet-head">
            <span className="sos__sheet-title">緊急ピットイン</span>
            <button
              type="button"
              className="sos__close"
              aria-label="SOS を閉じる"
              onClick={handleClose}
            >
              ✕
            </button>
          </div>

          <div className="sos__cats" role="group" aria-label="SOS カテゴリ">
            {SOS_CATEGORIES.map((meta) => (
              <button
                key={meta.category}
                type="button"
                className="sos__cat"
                data-active={selected === meta.category ? 'true' : undefined}
                aria-pressed={selected === meta.category}
                onClick={() => handleSelect(meta.category)}
              >
                <span className="sos__cat-icon" aria-hidden="true">
                  {meta.icon}
                </span>
                <span className="sos__cat-label">{meta.label}</span>
                <span className="sos__cat-hint">{meta.hint}</span>
              </button>
            ))}
          </div>

          {selectedMeta !== null && (
            <p className="sos__feedback" role="status" aria-live="polite">
              {selectedMeta.label}を探しています…
              <span className="sos__feedback-note">（近傍スポットの自動挿入は今後対応）</span>
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        className="sos__trigger"
        aria-label="SOS。長押しまたはスワイプで緊急アクションを開く"
        aria-expanded={phase === 'armed'}
        data-phase={phase}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="sos__ring" aria-hidden="true" />
        <span className="sos__label">SOS</span>
        <span className="sos__hint">長押し / スワイプ</span>
      </button>
    </div>
  )
}

export default SosButton
