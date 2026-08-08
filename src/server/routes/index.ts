import { Hono } from 'hono'
import { health } from './health'
import { search } from './search'

/**
 * `/api` 配下のサブアプリを構築する。
 * ルートグループごとに Hono インスタンスを分割し、ここで束ねる。
 */
export function createApiApp() {
  const api = new Hono<{ Bindings: CloudflareBindings }>()

  api.route('/health', health)
  api.route('/search', search)

  return api
}
