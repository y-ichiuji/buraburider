import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DetourSlider, detourLevelLabel } from './DetourSlider'

describe('detourLevelLabel', () => {
  it('各段階のラベルを返す', () => {
    expect(detourLevelLabel(0)).toBe('最短')
    expect(detourLevelLabel(2)).toBe('寄り道')
    expect(detourLevelLabel(5)).toBe('とことん寄り道')
  })

  it('未定義レベルはフォールバック文言', () => {
    expect(detourLevelLabel(99)).toBe('レベル 99')
  })
})

describe('DetourSlider', () => {
  it('値変更で onChange に数値を渡す', () => {
    const onChange = vi.fn()
    render(<DetourSlider value={0} onChange={onChange} />)

    fireEvent.change(screen.getByRole('slider', { name: '寄り道度' }), {
      target: { value: '3' }
    })

    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('現在値と段階ラベルを表示する', () => {
    render(<DetourSlider value={2} onChange={() => {}} />)

    const slider = screen.getByRole('slider', { name: '寄り道度' })
    expect(slider).toHaveValue('2')
    expect(slider).toHaveAttribute('aria-valuetext', '2 寄り道')
    expect(screen.getByText('寄り道')).toBeInTheDocument()
  })

  it('disabled で操作を無効化する', () => {
    render(<DetourSlider value={0} onChange={() => {}} disabled />)
    expect(screen.getByRole('slider', { name: '寄り道度' })).toBeDisabled()
  })
})
