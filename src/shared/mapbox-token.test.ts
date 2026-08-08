import { describe, expect, it } from 'vitest'
import { buildMapboxTokenScript, isValidPublicToken, MAPBOX_TOKEN_GLOBAL } from './mapbox-token'

describe('isValidPublicToken', () => {
  it('pk. で始まる文字列を有効とみなす', () => {
    expect(isValidPublicToken('pk.eyJ1Ijoi')).toBe(true)
  })

  it('未設定・空・プレースホルダを無効とみなす', () => {
    expect(isValidPublicToken(undefined)).toBe(false)
    expect(isValidPublicToken(null)).toBe(false)
    expect(isValidPublicToken('')).toBe(false)
    expect(isValidPublicToken('REPLACE_WITH_MAPBOX_PUBLIC_TOKEN')).toBe(false)
  })
})

describe('buildMapboxTokenScript', () => {
  it('window へ token を代入するスクリプトを生成する', () => {
    const script = buildMapboxTokenScript('pk.abc')
    expect(script).toBe(`window.${MAPBOX_TOKEN_GLOBAL}="pk.abc"`)
  })

  it('secret token を渡しても埋め込むのは渡した値のみ（副作用なし）', () => {
    // ルート側では public token のみ渡す前提。ここでは関数が余計な値を混ぜないことを確認する。
    const script = buildMapboxTokenScript('pk.public')
    expect(script).not.toContain('sk.')
  })

  it('</script> による早期終了・XSS を防ぐため < をエスケープする', () => {
    const script = buildMapboxTokenScript('pk.</script><img src=x>')
    expect(script).not.toContain('</script>')
    expect(script).toContain('\\u003c')
  })
})
