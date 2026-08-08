import { describe, expect, it } from 'vitest'
import {
  buildPlanRequest,
  DEFAULT_DETOUR_LEVEL,
  DETOUR_LEVEL_MAX,
  DETOUR_LEVEL_MIN,
  formatAtMinute,
  formatDistance,
  formatDuration,
  REST_TYPE_META
} from './plan'

describe('buildPlanRequest', () => {
  it('origin / destination と既定の detourLevel・休憩無効でボディを組み立てる', () => {
    const body = buildPlanRequest([139.767, 35.681], [138.727, 35.36])
    expect(body).toEqual({
      origin: [139.767, 35.681],
      destination: [138.727, 35.36],
      detourLevel: DEFAULT_DETOUR_LEVEL,
      rest: { enabled: false, intervalMinutes: 90, mode: 'konbini' }
    })
  })

  it('detourLevel を明示指定できる', () => {
    const body = buildPlanRequest([0, 0], [1, 1], 3)
    expect(body.detourLevel).toBe(3)
  })

  it('休憩設定を渡せる（省略時は無効）', () => {
    const rest = { enabled: true, intervalMinutes: 60, mode: 'local' as const }
    const body = buildPlanRequest([0, 0], [1, 1], 2, rest)
    expect(body.rest).toEqual(rest)
  })

  it('既定の detourLevel は 0（素のルート）', () => {
    expect(DEFAULT_DETOUR_LEVEL).toBe(0)
  })

  it('寄り道度の範囲はサーバー（0〜5）と一致する', () => {
    expect(DETOUR_LEVEL_MIN).toBe(0)
    expect(DETOUR_LEVEL_MAX).toBe(5)
  })
})

describe('formatDuration', () => {
  it('1時間未満は分のみ', () => {
    expect(formatDuration(45)).toBe('45分')
    expect(formatDuration(0)).toBe('0分')
  })

  it('1時間以上は時間+分', () => {
    expect(formatDuration(214)).toBe('3時間34分')
    expect(formatDuration(60)).toBe('1時間0分')
  })

  it('小数は丸める', () => {
    expect(formatDuration(89.6)).toBe('1時間30分')
  })
})

describe('formatDistance', () => {
  it('小数第1位までの文字列にする', () => {
    expect(formatDistance(152.4)).toBe('152.4')
    expect(formatDistance(10)).toBe('10.0')
  })
})

describe('formatAtMinute', () => {
  it('経過時間を「◯分後」形式にする', () => {
    expect(formatAtMinute(45)).toBe('45分後')
    expect(formatAtMinute(90)).toBe('1時間30分後')
  })
})

describe('REST_TYPE_META', () => {
  it('全休憩種別のラベル・アイコンを持つ', () => {
    for (const type of ['konbini', 'michinoeki', 'cafe', 'gas'] as const) {
      expect(REST_TYPE_META[type].label).toBeTruthy()
      expect(REST_TYPE_META[type].icon).toBeTruthy()
    }
  })
})
