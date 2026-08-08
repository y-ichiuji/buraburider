import { describe, expect, it } from 'vitest'
import { buildPlanRequest, DEFAULT_DETOUR_LEVEL, formatDistance, formatDuration } from './plan'

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

  it('既定の detourLevel は 0（素のルート）', () => {
    expect(DEFAULT_DETOUR_LEVEL).toBe(0)
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
