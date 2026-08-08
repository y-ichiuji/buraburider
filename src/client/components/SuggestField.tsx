// 目的地・出発地で共用する検索入力フィールド。
// 入力に対してデバウンス付きサジェスト（useSuggest）を表示し、候補選択を親へ通知する。

import type { Coord, SuggestItem } from '../../server/types'
import { useSuggest } from '../hooks/useSuggest'
import { SUGGEST_MIN_QUERY_LENGTH } from '../lib/suggest'
import { useState } from 'react'

export interface SuggestFieldProps {
  /** フィールド左の小ラベル（例: 出発 / 目的地）。 */
  label: string
  placeholder: string
  /** 入力文字列（制御コンポーネント）。 */
  query: string
  /** サジェストの近傍バイアス中心（出発地など）。null 可。 */
  proximity: Coord | null
  /** 選択中候補の id（aria-selected 用）。 */
  selectedId: string | null
  onQueryChange: (value: string) => void
  onSelect: (item: SuggestItem) => void
}

export function SuggestField({
  label,
  placeholder,
  query,
  proximity,
  selectedId,
  onQueryChange,
  onSelect
}: SuggestFieldProps) {
  const [open, setOpen] = useState(false)
  const { items, status } = useSuggest(query, proximity)
  const showSuggest = open && query.trim().length >= SUGGEST_MIN_QUERY_LENGTH

  function handleSelect(item: SuggestItem) {
    onSelect(item)
    setOpen(false)
  }

  return (
    <div className="field field--search">
      <span className="field__label">{label}</span>
      <input
        className="field__input"
        type="text"
        inputMode="search"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={label}
        autoComplete="off"
      />
      {status === 'loading' && <span className="field__spinner">検索中…</span>}

      {showSuggest && (
        <ul className="suggest-list" role="listbox">
          {status === 'error' && (
            <li className="suggest-item suggest-item--empty">候補の取得に失敗しました</li>
          )}
          {status !== 'error' && items.length === 0 && (
            <li className="suggest-item suggest-item--empty">候補がありません</li>
          )}
          {items.map((item) => (
            <li key={item.id} role="option" aria-selected={selectedId === item.id}>
              <button
                type="button"
                className="suggest-item"
                // input の blur より先にクリックを処理させ、リストが閉じるのを防ぐ。
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(item)}
              >
                <span className="suggest-item__name">{item.name}</span>
                {item.fullAddress && <span className="suggest-item__addr">{item.fullAddress}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default SuggestField
