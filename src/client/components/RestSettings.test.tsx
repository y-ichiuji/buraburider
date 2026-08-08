import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { RestConfig } from '../../server/types'
import { RestSettings } from './RestSettings'

const OFF: RestConfig = { enabled: false, intervalMinutes: 90, mode: 'konbini' }
const ON: RestConfig = { enabled: true, intervalMinutes: 90, mode: 'konbini' }

describe('RestSettings', () => {
  it('OFF 時はトグルのみで本体（間隔・モード）は非表示', () => {
    render(<RestSettings value={OFF} onChange={() => {}} />)

    const toggle = screen.getByRole('switch', { name: 'スマート休憩の有効化' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('group', { name: '休憩間隔' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '休憩モード' })).not.toBeInTheDocument()
  })

  it('トグルで enabled を反転して onChange する', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<RestSettings value={OFF} onChange={onChange} />)

    await user.click(screen.getByRole('switch', { name: 'スマート休憩の有効化' }))
    expect(onChange).toHaveBeenCalledWith({ ...OFF, enabled: true })
  })

  it('ON 時は間隔プリセットとモードを表示する', () => {
    render(<RestSettings value={ON} onChange={() => {}} />)

    expect(screen.getByRole('group', { name: '休憩間隔' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '60分' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '90分' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '120分' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '休憩モード' })).toBeInTheDocument()
  })

  it('間隔プリセット選択で intervalMinutes を onChange する', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<RestSettings value={ON} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: '120分' }))
    expect(onChange).toHaveBeenCalledWith({ ...ON, intervalMinutes: 120 })
  })

  it('モード4択の選択で mode を onChange する', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<RestSettings value={ON} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: /ご当地/ }))
    expect(onChange).toHaveBeenCalledWith({ ...ON, mode: 'local' })

    await user.click(screen.getByRole('button', { name: /絶景カフェ/ }))
    expect(onChange).toHaveBeenCalledWith({ ...ON, mode: 'cafe' })

    await user.click(screen.getByRole('button', { name: /緊急/ }))
    expect(onChange).toHaveBeenCalledWith({ ...ON, mode: 'emergency' })
  })

  it('選択中の間隔・モードは aria-pressed=true', () => {
    render(
      <RestSettings
        value={{ enabled: true, intervalMinutes: 60, mode: 'cafe' }}
        onChange={() => {}}
      />
    )

    expect(screen.getByRole('button', { name: '60分' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '90分' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /絶景カフェ/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('disabled でトグルを無効化する', () => {
    render(<RestSettings value={OFF} onChange={() => {}} disabled />)
    expect(screen.getByRole('switch', { name: 'スマート休憩の有効化' })).toBeDisabled()
  })
})
