import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuggestItem } from '../../server/types'
import { buildSuggestUrl, SUGGEST_DEBOUNCE_MS } from '../lib/suggest'
import { useSuggest } from './useSuggest'

const ITEMS: SuggestItem[] = [
  { id: 'fuji', name: '富士山', coord: [138.7274, 35.3606], fullAddress: '静岡県' }
]

/** items を返す fetch モック。 */
function mockFetchItems(items: SuggestItem[]) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items }) } as Response)
}

describe('useSuggest', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('最小文字数未満では叩かない', async () => {
    const fetchMock = mockFetchItems([])
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSuggest('a', null))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS + 200)
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
    expect(result.current.items).toEqual([])
  })

  it('デバウンス待機後に fetch して items を反映する', async () => {
    const fetchMock = mockFetchItems(ITEMS)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSuggest('富士', [139, 35]))

    // デバウンス未満では発火しない。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS - 100)
    })
    expect(fetchMock).not.toHaveBeenCalled()

    // 閾値到達で発火し、結果が反映される。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(buildSuggestUrl('富士', [139, 35]), {
      signal: expect.any(AbortSignal)
    })
    expect(result.current.items).toEqual(ITEMS)
    expect(result.current.status).toBe('idle')
  })

  it('入力が変わると前リクエストを AbortController で中断する', async () => {
    let capturedSignal: AbortSignal | undefined
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined
      return new Promise<Response>(() => {}) // 解決しない（中断を観察するため）。
    })
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = renderHook(({ q }: { q: string }) => useSuggest(q, null), {
      initialProps: { q: 'ab' }
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS)
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(capturedSignal?.aborted).toBe(false)

    // クエリ変更 → effect クリーンアップで前回の signal が abort される。
    rerender({ q: 'abc' })
    expect(capturedSignal?.aborted).toBe(true)
  })

  it('取得失敗時は status error / items 空', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSuggest('温泉', null))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS)
    })

    expect(result.current.status).toBe('error')
    expect(result.current.items).toEqual([])
  })
})
