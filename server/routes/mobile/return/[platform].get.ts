import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3'

// Adapted from the mobile worktree's return hint. Query values are never reflected or interpreted.
export default defineEventHandler((event) => {
  if (!['android', 'ios'].includes(getRouterParam(event, 'platform') ?? '')) {
    throw createError({ statusCode: 404 })
  }
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  setResponseHeader(event, 'Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Onerway Demo</title><h1>请返回 Onerway Demo App</h1><p>在 App 中查询支付结果。此页面不代表支付成功。</p></html>'
})
