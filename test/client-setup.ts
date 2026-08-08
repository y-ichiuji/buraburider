// client プロジェクト（happy-dom）のセットアップ。
// @testing-library/jest-dom のカスタムマッチャ（toBeInTheDocument など）を有効化する。
// @testing-library/react は globals 有効時に afterEach で自動 cleanup する。
import '@testing-library/jest-dom/vitest'
