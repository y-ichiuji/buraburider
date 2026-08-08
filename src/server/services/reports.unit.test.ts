import { describe, expect, it } from 'vitest'
import { parseBbox, parseCreateReportRequest } from './reports'

describe('parseCreateReportRequest', () => {
  it('正しい報告を受理する', () => {
    const r = parseCreateReportRequest({ coord: [139.767, 35.681], hazard: 'gravel' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.coord).toEqual([139.767, 35.681])
      expect(r.value.hazard).toBe('gravel')
    }
  })

  it('coord 欠落は不受理', () => {
    expect(parseCreateReportRequest({ hazard: 'ice' }).ok).toBe(false)
  })

  it('coord が2要素でなければ不受理', () => {
    expect(parseCreateReportRequest({ coord: [139.767], hazard: 'ice' }).ok).toBe(false)
  })

  it('緯度経度が範囲外なら不受理', () => {
    expect(parseCreateReportRequest({ coord: [200, 35], hazard: 'ice' }).ok).toBe(false)
    expect(parseCreateReportRequest({ coord: [139, 100], hazard: 'ice' }).ok).toBe(false)
  })

  it('未知の hazard は不受理', () => {
    expect(parseCreateReportRequest({ coord: [139, 35], hazard: 'mud' }).ok).toBe(false)
  })

  it('全 hazard 種別を受理する', () => {
    for (const hazard of ['gravel', 'leaves', 'ice']) {
      expect(parseCreateReportRequest({ coord: [139, 35], hazard }).ok).toBe(true)
    }
  })

  it('オブジェクトでなければ不受理', () => {
    expect(parseCreateReportRequest(null).ok).toBe(false)
    expect(parseCreateReportRequest('x').ok).toBe(false)
  })
})

describe('parseBbox', () => {
  it('未指定は null（範囲なし）で受理', () => {
    const r = parseBbox(undefined)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBeNull()
  })

  it('正しい4要素を受理する', () => {
    const r = parseBbox('138.5,34.5,139.5,35.5')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual([138.5, 34.5, 139.5, 35.5])
  })

  it('要素数が4でなければ不受理', () => {
    expect(parseBbox('1,2,3').ok).toBe(false)
  })

  it('数値でない要素があれば不受理', () => {
    expect(parseBbox('1,2,3,x').ok).toBe(false)
  })

  it('min > max は不受理', () => {
    expect(parseBbox('139.5,34.5,138.5,35.5').ok).toBe(false)
  })
})
