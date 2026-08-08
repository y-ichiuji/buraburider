import { useEffect, useState } from 'react'
import type { Coord, SuggestItem } from '../../server/types'
import {
  buildSuggestUrl,
  shouldQuery,
  SUGGEST_DEBOUNCE_MS,
  type SuggestResponse
} from '../lib/suggest'

export type SuggestStatus = 'idle' | 'loading' | 'error'

export interface SuggestState {
  items: SuggestItem[]
  status: SuggestStatus
}

/**
 * 目的地入力に対するオートコンプリート。
 * query が最小長を満たすとデバウンス後に `GET /api/search/suggest` を叩き候補を返す。
 * 入力が変わるたびに前回のリクエストは中断（AbortController）される。
 *
 * @param query 目的地の入力文字列
 * @param proximity 近傍バイアスの中心（出発地など）。null なら付与しない。
 */
export function useSuggest(query: string, proximity: Coord | null): SuggestState {
  const [state, setState] = useState<SuggestState>({ items: [], status: 'idle' })

  useEffect(() => {
    if (!shouldQuery(query)) {
      setState({ items: [], status: 'idle' })
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(() => {
      setState((prev) => ({ items: prev.items, status: 'loading' }))
      void fetchSuggest(query, proximity, controller.signal)
        .then((items) => setState({ items, status: 'idle' }))
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setState({ items: [], status: 'error' })
        })
    }, SUGGEST_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, proximity])

  return state
}

async function fetchSuggest(
  query: string,
  proximity: Coord | null,
  signal: AbortSignal
): Promise<SuggestItem[]> {
  const res = await fetch(buildSuggestUrl(query, proximity), { signal })
  if (!res.ok) throw new Error(`サジェスト取得に失敗しました (${res.status})`)
  const data = (await res.json()) as SuggestResponse
  return data.items ?? []
}
