import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PlanResponse } from '../../server/types'
import { RoutePanel } from './RoutePanel'

const PLAN: PlanResponse = {
  route: {
    geojson: {
      type: 'LineString',
      coordinates: [
        [139, 35],
        [138, 34]
      ]
    },
    distanceKm: 12.34,
    durationMin: 95
  },
  waypoints: [
    { type: 'scenic', name: '絶景峠', coord: [139.1, 35.1] },
    { type: 'winding', name: 'ワインディング林道', coord: [139.2, 35.2] }
  ],
  rests: [{ type: 'konbini', name: 'ローソン◯◯店', atMinute: 60, coord: [139.3, 35.3] }]
}

describe('RoutePanel', () => {
  it('loading 中はプレースホルダを表示', () => {
    render(<RoutePanel plan={null} status="loading" error={null} />)
    expect(screen.getByText('ルートを生成中…')).toBeInTheDocument()
  })

  it('error 時はメッセージを alert で表示', () => {
    render(<RoutePanel plan={null} status="error" error="ルートが見つかりません" />)
    expect(screen.getByRole('alert')).toHaveTextContent('ルートが見つかりません')
  })

  it('error で error が null なら既定文言', () => {
    render(<RoutePanel plan={null} status="error" error={null} />)
    expect(screen.getByText('ルート生成に失敗しました')).toBeInTheDocument()
  })

  it('idle かつ plan なしなら何も描画しない', () => {
    const { container } = render(<RoutePanel plan={null} status="idle" error={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('成功時に距離・所要時間・立ち寄り一覧・休憩一覧を表示', () => {
    render(<RoutePanel plan={PLAN} status="idle" error={null} />)

    // 距離（小数第1位）・所要時間（H時間M分）。
    expect(screen.getByText('12.3')).toBeInTheDocument()
    expect(screen.getByText('1時間35分')).toBeInTheDocument()

    // 立ち寄り（waypoints）。
    const stops = screen.getByRole('list', { name: '立ち寄りスポット' })
    expect(stops).toHaveTextContent('絶景峠')
    expect(stops).toHaveTextContent('絶景')
    expect(stops).toHaveTextContent('ワインディング林道')
    expect(stops).toHaveTextContent('ワインディング')

    // 休憩（rests）。到達目安「◯分後」とラベル。
    const rests = screen.getByRole('list', { name: '休憩スポット' })
    expect(rests).toHaveTextContent('ローソン◯◯店')
    expect(rests).toHaveTextContent('1時間0分後')
    expect(rests).toHaveTextContent('コンビニ')
  })

  it('waypoints/rests が空なら一覧を描画しない', () => {
    render(<RoutePanel plan={{ ...PLAN, waypoints: [], rests: [] }} status="idle" error={null} />)
    expect(screen.queryByRole('list', { name: '立ち寄りスポット' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '休憩スポット' })).not.toBeInTheDocument()
  })
})
