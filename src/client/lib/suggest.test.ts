import { describe, expect, it } from 'vitest'
import { buildSuggestUrl, formatProximity, shouldQuery, SUGGEST_MIN_QUERY_LENGTH } from './suggest'

describe('formatProximity', () => {
  it('Coord を "lng,lat" 文字列にする', () => {
    expect(formatProximity([139.767, 35.681])).toBe('139.767,35.681')
  })
})

describe('buildSuggestUrl', () => {
  it('q をトリムして付与する', () => {
    const url = new URL(buildSuggestUrl('  富士山 '), 'http://x')
    expect(url.pathname).toBe('/api/search/suggest')
    expect(url.searchParams.get('q')).toBe('富士山')
    expect(url.searchParams.has('proximity')).toBe(false)
  })

  it('proximity があれば "lng,lat" で付与する', () => {
    const url = new URL(buildSuggestUrl('温泉', [139.7, 35.6]), 'http://x')
    expect(url.searchParams.get('proximity')).toBe('139.7,35.6')
  })

  it('proximity が null なら付与しない', () => {
    const url = new URL(buildSuggestUrl('温泉', null), 'http://x')
    expect(url.searchParams.has('proximity')).toBe(false)
  })
})

describe('shouldQuery', () => {
  it('最小長以上で true', () => {
    expect(shouldQuery('あ'.repeat(SUGGEST_MIN_QUERY_LENGTH))).toBe(true)
  })

  it('最小長未満・空白のみで false', () => {
    expect(shouldQuery('a')).toBe(false)
    expect(shouldQuery('   ')).toBe(false)
  })
})
