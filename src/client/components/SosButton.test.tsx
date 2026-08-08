import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SOS_LONG_PRESS_MS, SOS_SWIPE_THRESHOLD_PX } from '../lib/sos'
import { SosButton } from './SosButton'

/** SOS トリガーボタンを取得する。 */
function getTrigger(): HTMLElement {
  return screen.getByRole('button', { name: /長押しまたはスワイプ/ })
}

describe('SosButton', () => {
  beforeAll(() => {
    // happy-dom は setPointerCapture 未実装のため no-op を差し込む。
    if (typeof HTMLElement.prototype.setPointerCapture !== 'function') {
      HTMLElement.prototype.setPointerCapture = () => {}
    }
  })

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('1秒長押しで発動しカテゴリシートを開く', () => {
    render(<SosButton />)
    const trigger = getTrigger()

    fireEvent.pointerDown(trigger, { pointerId: 1, clientX: 10, clientY: 10 })
    act(() => {
      vi.advanceTimersByTime(SOS_LONG_PRESS_MS)
    })

    expect(screen.getByRole('dialog', { name: 'SOS 緊急アクション' })).toBeInTheDocument()
  })

  it('スワイプ（閾値超えの移動）で発動する', () => {
    render(<SosButton />)
    const trigger = getTrigger()

    fireEvent.pointerDown(trigger, { pointerId: 1, clientX: 0, clientY: 0 })
    act(() => {
      fireEvent.pointerMove(trigger, {
        pointerId: 1,
        clientX: SOS_SWIPE_THRESHOLD_PX + 10,
        clientY: 0
      })
    })

    expect(screen.getByRole('dialog', { name: 'SOS 緊急アクション' })).toBeInTheDocument()
  })

  it('単純タップ（短時間・微動で離す）では発動しない', () => {
    render(<SosButton />)
    const trigger = getTrigger()

    fireEvent.pointerDown(trigger, { pointerId: 1, clientX: 0, clientY: 0 })
    act(() => {
      vi.advanceTimersByTime(300) // 1秒未満
    })
    fireEvent.pointerMove(trigger, { pointerId: 1, clientX: 3, clientY: 3 }) // 閾値未満
    fireEvent.pointerUp(trigger, { pointerId: 1, clientX: 3, clientY: 3 })

    expect(screen.queryByRole('dialog', { name: 'SOS 緊急アクション' })).not.toBeInTheDocument()
  })

  it('発動前に指を離すと待機に戻る（誤タップ扱い）', () => {
    render(<SosButton />)
    const trigger = getTrigger()

    fireEvent.pointerDown(trigger, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerUp(trigger, { pointerId: 1, clientX: 0, clientY: 0 })
    // 離した後にタイマーが進んでも発動しない。
    act(() => {
      vi.advanceTimersByTime(SOS_LONG_PRESS_MS)
    })

    expect(screen.queryByRole('dialog', { name: 'SOS 緊急アクション' })).not.toBeInTheDocument()
  })

  it('発動後にカテゴリ選択でフィードバックを表示する', () => {
    render(<SosButton />)
    const trigger = getTrigger()

    fireEvent.pointerDown(trigger, { pointerId: 1, clientX: 10, clientY: 10 })
    act(() => {
      vi.advanceTimersByTime(SOS_LONG_PRESS_MS)
    })

    fireEvent.click(screen.getByRole('button', { name: /トイレ/ }))
    expect(screen.getByRole('status')).toHaveTextContent('トイレを探しています')
  })

  it('発動後に閉じるボタンで待機に戻る', () => {
    render(<SosButton />)
    const trigger = getTrigger()

    fireEvent.pointerDown(trigger, { pointerId: 1, clientX: 10, clientY: 10 })
    act(() => {
      vi.advanceTimersByTime(SOS_LONG_PRESS_MS)
    })
    expect(screen.getByRole('dialog', { name: 'SOS 緊急アクション' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'SOS を閉じる' }))
    expect(screen.queryByRole('dialog', { name: 'SOS 緊急アクション' })).not.toBeInTheDocument()
  })
})
