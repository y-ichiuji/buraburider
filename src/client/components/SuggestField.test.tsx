import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SuggestItem } from '../../server/types'
import { SuggestField } from './SuggestField'

const ITEMS: SuggestItem[] = [
  { id: 'fuji', name: '富士山', coord: [138.7274, 35.3606], fullAddress: '静岡県富士宮市' }
]

/** items を返す fetch モック。 */
function stubFetchItems(items: SuggestItem[]) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ items }) } as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** query を内部 state で管理する制御ラッパ（親の挙動を再現）。 */
function Harness({ onSelect }: { onSelect: (item: SuggestItem) => void }) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  return (
    <SuggestField
      label="目的地"
      placeholder="行き先を検索"
      query={query}
      proximity={null}
      selectedId={selectedId}
      onQueryChange={setQuery}
      onSelect={(item) => {
        setSelectedId(item.id)
        setQuery(item.name)
        onSelect(item)
      }}
    />
  )
}

describe('SuggestField', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('入力→候補表示→選択で onSelect し、リストが閉じる', async () => {
    stubFetchItems(ITEMS)
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSelect={onSelect} />)

    await user.type(screen.getByRole('textbox', { name: '目的地' }), '富士')

    // デバウンス後に候補が出る（findBy が待つ）。
    const option = await screen.findByRole('button', { name: /富士山/ })
    expect(option).toHaveTextContent('静岡県富士宮市')

    await user.click(option)
    expect(onSelect).toHaveBeenCalledWith(ITEMS[0])
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('候補0件なら「候補がありません」を表示', async () => {
    stubFetchItems([])
    const user = userEvent.setup()
    render(<Harness onSelect={() => {}} />)

    await user.type(screen.getByRole('textbox', { name: '目的地' }), '存在しない場所')
    expect(await screen.findByText('候補がありません')).toBeInTheDocument()
  })

  it('取得失敗なら「候補の取得に失敗しました」を表示', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<Harness onSelect={() => {}} />)

    await user.type(screen.getByRole('textbox', { name: '目的地' }), '温泉')
    expect(await screen.findByText('候補の取得に失敗しました')).toBeInTheDocument()
  })

  it('最小文字数未満ではリストを開かない', async () => {
    const fetchMock = stubFetchItems(ITEMS)
    const user = userEvent.setup()
    render(<Harness onSelect={() => {}} />)

    await user.type(screen.getByRole('textbox', { name: '目的地' }), 'a')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('選択中候補は aria-selected=true で表示する', async () => {
    stubFetchItems(ITEMS)
    const user = userEvent.setup()
    render(
      <SuggestField
        label="目的地"
        placeholder="行き先を検索"
        query="富士"
        proximity={null}
        selectedId="fuji"
        onQueryChange={() => {}}
        onSelect={() => {}}
      />
    )

    // フォーカスでリストを開く。
    await user.click(screen.getByRole('textbox', { name: '目的地' }))
    const option = await screen.findByRole('option')
    expect(option).toHaveAttribute('aria-selected', 'true')
  })
})
