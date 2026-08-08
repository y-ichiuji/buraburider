// RideSession Durable Object（④ 走行中の緊急アクション／SOS の土台）。
//
// Agents SDK の `Agent` を継承し、走行セッションの状態（現在ルート・進捗・SOS 前の元ルート）を
// SQLite バックの state として保持する。1 ライド = 1 インスタンス（getByName / useAgent の name で識別）。
//
// 本ステップは「状態を保持できる土台」まで。自動復帰ロジック（現在地から元ルートへ再接続する
// ルート再計算など）はスコープ外で、下記メソッドのコメントに差し込み口だけ残す。
//
// メソッドは public な通常メソッドとして公開する。同一コードベースの Worker や DO スタブ（テスト）
// からは DO RPC でそのまま呼べる（agents-sdk: 「Worker calling agent (same codebase) → DO RPC」）。
// ブラウザから WebSocket RPC で直接呼べるようにする場合は、各メソッドに `@callable()`
// （import { callable } from 'agents'）を付与する。将来クライアント（useAgent().call(...)）と
// 接続する段でデコレータを足せば良い。

import { Agent } from 'agents'
import type { PlanResponse, RideSessionState } from '../server/types'

/** セッション開始前の初期状態。 */
const INITIAL_STATE: RideSessionState = {
  route: null,
  progress: 0,
  sosActive: false,
  routeBeforeSos: null
}

/** 進捗値を 0〜1 に収める。 */
function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.max(0, Math.min(1, progress))
}

export class RideSession extends Agent<CloudflareBindings, RideSessionState> {
  initialState: RideSessionState = INITIAL_STATE

  /**
   * ナビ開始・ルート更新。現在ルートを差し替え、進捗を 0 に戻す。
   * SOS 中の再ルートには使わない（そちらは startSos / resume を使う）。
   */
  setRoute(route: PlanResponse): RideSessionState {
    this.setState({ ...this.state, route, progress: 0 })
    return this.state
  }

  /** 走行進捗（0〜1）の更新。クライアントの現在地追従から定期的に呼ばれる想定。 */
  updateProgress(progress: number): RideSessionState {
    this.setState({ ...this.state, progress: clampProgress(progress) })
    return this.state
  }

  /**
   * SOS 発動。現在ルートを `routeBeforeSos` に退避し、SOS モードへ入る。
   *
   * 将来の差し込み口: ここで「最寄りの安全地点（GS・コンビニ・病院など）への
   * 緊急ルート」を計算して `route` に差し込む（architecture.md ④ の1発自動挿入）。
   * 本ステップでは状態の退避のみ行い、ルート差し替えは行わない。
   */
  startSos(): RideSessionState {
    if (this.state.sosActive) return this.state
    this.setState({
      ...this.state,
      sosActive: true,
      routeBeforeSos: this.state.route
    })
    return this.state
  }

  /**
   * SOS からの復帰。退避していた元ルートへ戻し、SOS モードを解除する。
   *
   * 将来の差し込み口: 現在地から元ルートへ再接続するルートを再計算して復帰する
   * （architecture.md ④ の自動復帰）。本ステップでは退避ルートをそのまま復元するのみ。
   */
  resume(): RideSessionState {
    this.setState({
      ...this.state,
      sosActive: false,
      route: this.state.routeBeforeSos ?? this.state.route,
      routeBeforeSos: null
    })
    return this.state
  }

  /** 現在のセッション状態を取得する。 */
  getSnapshot(): RideSessionState {
    return this.state
  }
}
