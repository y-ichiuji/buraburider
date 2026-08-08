import { describe, expect, it } from 'vitest'
import { DEFAULT_ORIGIN, positionToCoord } from './geo'

describe('DEFAULT_ORIGIN', () => {
  it('東京駅の [lng, lat] を持つ', () => {
    expect(DEFAULT_ORIGIN).toEqual([139.767, 35.681])
  })
})

describe('positionToCoord', () => {
  it('GeolocationPosition を [lng, lat] に変換する', () => {
    const position = {
      coords: { longitude: 139.7, latitude: 35.6 }
    } as GeolocationPosition
    expect(positionToCoord(position)).toEqual([139.7, 35.6])
  })
})
