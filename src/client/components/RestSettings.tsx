// 休憩設定 UI（ステップ5: 機能②）。
// 休憩の ON/OFF・間隔（60/90/120 分プリセット）・モード（4 択）を選ぶ。
// 値は上位（app）が RestConfig として state 管理する。黒×オレンジのメーター調。

import type { RestConfig, RestMode } from '../../server/types'
import { REST_INTERVAL_PRESETS } from '../lib/plan'

/** 休憩モードの表示情報（ラベル・補足・アイコン）。 */
interface RestModeOption {
  mode: RestMode
  label: string
  hint: string
  icon: string
}

/** モード選択の 4 択（architecture.md のモード対応）。 */
export const REST_MODE_OPTIONS: readonly RestModeOption[] = [
  { mode: 'konbini', label: 'サクッと', hint: 'コンビニ', icon: '🏪' },
  { mode: 'local', label: 'ご当地', hint: '道の駅・特産品', icon: '🍶' },
  { mode: 'cafe', label: '絶景カフェ', hint: 'カフェ・展望', icon: '☕' },
  { mode: 'emergency', label: '緊急', hint: 'ガソリンスタンド', icon: '⛽' }
]

export interface RestSettingsProps {
  /** 現在の休憩設定。 */
  value: RestConfig
  /** 設定変更時に呼ばれる。 */
  onChange: (value: RestConfig) => void
  /** 操作を無効化する（生成中など）。 */
  disabled?: boolean
}

/**
 * 休憩設定パネル。ON にすると間隔プリセットとモード選択が展開される。
 */
export function RestSettings({ value, onChange, disabled }: RestSettingsProps) {
  function toggleEnabled() {
    onChange({ ...value, enabled: !value.enabled })
  }

  function selectInterval(intervalMinutes: number) {
    onChange({ ...value, intervalMinutes })
  }

  function selectMode(mode: RestMode) {
    onChange({ ...value, mode })
  }

  return (
    <div className="rest-settings" data-disabled={disabled ? 'true' : undefined}>
      <div className="rest-settings__head">
        <div className="rest-settings__title-group">
          <span className="rest-settings__title">スマート休憩</span>
          <span className="rest-settings__sub">
            {value.enabled ? `${value.intervalMinutes}分ごとに休憩を提案` : '休憩の自動提案'}
          </span>
        </div>
        <button
          type="button"
          className="rest-settings__toggle"
          role="switch"
          aria-checked={value.enabled}
          aria-label="スマート休憩の有効化"
          disabled={disabled}
          data-on={value.enabled ? 'true' : undefined}
          onClick={toggleEnabled}
        >
          <span className="rest-settings__knob" />
        </button>
      </div>

      {value.enabled && (
        <div className="rest-settings__body">
          <div className="rest-settings__section">
            <span className="rest-settings__section-label">間隔</span>
            <div className="seg" role="group" aria-label="休憩間隔">
              {REST_INTERVAL_PRESETS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className="seg__item"
                  aria-pressed={value.intervalMinutes === minutes}
                  data-active={value.intervalMinutes === minutes ? 'true' : undefined}
                  disabled={disabled}
                  onClick={() => selectInterval(minutes)}
                >
                  {minutes}分
                </button>
              ))}
            </div>
          </div>

          <div className="rest-settings__section">
            <span className="rest-settings__section-label">モード</span>
            <div className="rest-mode-grid" role="group" aria-label="休憩モード">
              {REST_MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  className="rest-mode"
                  aria-pressed={value.mode === opt.mode}
                  data-active={value.mode === opt.mode ? 'true' : undefined}
                  disabled={disabled}
                  onClick={() => selectMode(opt.mode)}
                >
                  <span className="rest-mode__icon" aria-hidden="true">
                    {opt.icon}
                  </span>
                  <span className="rest-mode__label">{opt.label}</span>
                  <span className="rest-mode__hint">{opt.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default RestSettings
