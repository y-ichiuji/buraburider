// 寄り道度スライダー（0-5）。黒×オレンジのメーター調。
// 0 = 最短ルート、5 = とことん寄り道。値は上位（app）が state 管理する。

import { DETOUR_LEVEL_MAX, DETOUR_LEVEL_MIN } from '../lib/plan'

/** 各段階の短いラベル（両端とそれ以外で表現を変える）。 */
const LEVEL_LABELS: Record<number, string> = {
  0: '最短',
  1: 'ちょい寄り道',
  2: '寄り道',
  3: 'しっかり寄り道',
  4: 'たっぷり寄り道',
  5: 'とことん寄り道'
}

/** レベルに対応するラベルを返す。 */
export function detourLevelLabel(level: number): string {
  return LEVEL_LABELS[level] ?? `レベル ${level}`
}

export interface DetourSliderProps {
  /** 現在の寄り道度（0-5）。 */
  value: number
  /** 値変更時に呼ばれる。 */
  onChange: (value: number) => void
  /** 操作を無効化する（生成中など）。 */
  disabled?: boolean
}

/**
 * 寄り道度スライダー。距離ではなく「どれだけ寄り道するか」を選ぶ。
 * range の充填はオレンジ、レール上に段階の目盛りを打つ。
 */
export function DetourSlider({ value, onChange, disabled }: DetourSliderProps) {
  const span = DETOUR_LEVEL_MAX - DETOUR_LEVEL_MIN
  const fillPercent = span > 0 ? ((value - DETOUR_LEVEL_MIN) / span) * 100 : 0

  return (
    <div className="detour-slider" data-disabled={disabled ? 'true' : undefined}>
      <div className="detour-slider__head">
        <span className="detour-slider__title">寄り道度</span>
        <span className="detour-slider__value">
          <span className="detour-slider__num">{value}</span>
          <span className="detour-slider__label">{detourLevelLabel(value)}</span>
        </span>
      </div>

      <input
        type="range"
        className="detour-slider__range"
        min={DETOUR_LEVEL_MIN}
        max={DETOUR_LEVEL_MAX}
        step={1}
        value={value}
        disabled={disabled}
        aria-label="寄り道度"
        aria-valuetext={`${value} ${detourLevelLabel(value)}`}
        style={{ '--fill': `${fillPercent}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />

      <div className="detour-slider__scale" aria-hidden="true">
        <span>最短</span>
        <span>とことん寄り道</span>
      </div>
    </div>
  )
}

export default DetourSlider
