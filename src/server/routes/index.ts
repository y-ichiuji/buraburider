import { Hono } from 'hono'
import { health } from './health'
import { plan } from './plan'
import { reports } from './reports'
import { search } from './search'

/**
 * `/api` 配下のサブアプリを構築する。
 * ルートグループごとに Hono インスタンスを分割し、ここで束ねる。
 */
export function createApiApp() {
  const api = new Hono<{ Bindings: CloudflareBindings }>()

  api.route('/health', health)
  api.route('/search', search)
  api.route('/routes', plan)
  api.route('/reports', reports)

  return api
}
