import { describe, expect, it } from 'vitest'
import {
  evaluateSosGesture,
  isLongPressReached,
  isSwipeReached,
  pointerDistance,
  SOS_CATEGORIES,
  SOS_LONG_PRESS_MS,
  SOS_SWIPE_THRESHOLD_PX
} from './sos'

describe('pointerDistance', () => {
  it('ユークリッド距離を返す', () => {
    expect(pointerDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(pointerDistance({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0)
  })
})

describe('isLongPressReached', () => {
  it('閾値以上で true', () => {
    expect(isLongPressReached(SOS_LONG_PRESS_MS)).toBe(true)
    expect(isLongPressReached(SOS_LONG_PRESS_MS + 200)).toBe(true)
  })

  it('閾値未満で false', () => {
    expect(isLongPressReached(SOS_LONG_PRESS_MS - 1)).toBe(false)
    expect(isLongPressReached(0)).toBe(false)
  })
})

describe('isSwipeReached', () => {
  it('移動量が閾値以上で true', () => {
    expect(isSwipeReached({ x: 0, y: 0 }, { x: SOS_SWIPE_THRESHOLD_PX, y: 0 })).toBe(true)
    expect(isSwipeReached({ x: 0, y: 0 }, { x: 0, y: SOS_SWIPE_THRESHOLD_PX + 10 })).toBe(true)
  })

  it('移動量が閾値未満で false（微小な指ブレは発動しない）', () => {
    expect(isSwipeReached({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe(false)
    expect(isSwipeReached({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(false)
  })
})

describe('evaluateSosGesture', () => {
  it('スワイプ閾値を超えたら swipe', () => {
    const trigger = evaluateSosGesture({
      start: { x: 0, y: 0 },
      current: { x: SOS_SWIPE_THRESHOLD_PX + 1, y: 0 },
      heldMs: 100
    })
    expect(trigger).toBe('swipe')
  })

  it('動かず長押し閾値に達したら longpress', () => {
    const trigger = evaluateSosGesture({
      start: { x: 0, y: 0 },
      current: { x: 2, y: 2 },
      heldMs: SOS_LONG_PRESS_MS
    })
    expect(trigger).toBe('longpress')
  })

  it('どちらも未達なら null（誤作動しない）', () => {
    const trigger = evaluateSosGesture({
      start: { x: 0, y: 0 },
      current: { x: 3, y: 3 },
      heldMs: 300
    })
    expect(trigger).toBeNull()
  })

  it('スワイプと長押しが同時成立ならスワイプを優先', () => {
    const trigger = evaluateSosGesture({
      start: { x: 0, y: 0 },
      current: { x: SOS_SWIPE_THRESHOLD_PX, y: 0 },
      heldMs: SOS_LONG_PRESS_MS + 500
    })
    expect(trigger).toBe('swipe')
  })
})

describe('SOS_CATEGORIES', () => {
  it('トイレ・GS・雨宿りの3種を持ち、将来の検索カテゴリ差し込み口を備える', () => {
    expect(SOS_CATEGORIES.map((c) => c.category)).toEqual(['toilet', 'gas', 'shelter'])
    for (const meta of SOS_CATEGORIES) {
      expect(meta.label).toBeTruthy()
      expect(meta.icon).toBeTruthy()
      expect(meta.searchCategory).toBeTruthy()
    }
  })
})
