export default defineEventHandler((event) => {
  if (!['GET', 'HEAD'].includes(event.method)) return

  const url = getRequestURL(event)
  if (!/^\/halden\/return\/[A-Za-z0-9-]{1,128}\/?$/.test(url.pathname)) return

  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')

  // Drop provider parameters before Nuxt serializes the initial route into
  // hydration data. The recovery cookie, not the query, authorizes the order.
  if (url.search) return sendRedirect(event, url.pathname, 303)
})
