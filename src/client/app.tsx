// トップ画面のアプリシェル（後続ステップの土台）。
// 地図・寄り道スライダー・休憩設定・SOS ボタンなどはステップ 2 以降で実装する。
// ここでは黒 × オレンジのデザイントークンを使った最小の骨組みだけを置く。

function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__logo">Buraburider</span>
        <span className="app-header__sub">ブラブライダー</span>
      </header>

      <main className="app-main">
        <section className="map-placeholder" aria-label="地図プレースホルダ">
          <p className="map-placeholder__label">MAP</p>
          <p className="map-placeholder__hint">地図はステップ 2 で表示します</p>
        </section>
      </main>
    </div>
  )
}

export default App
