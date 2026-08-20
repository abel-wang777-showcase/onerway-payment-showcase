const UPSTREAM = 'https://onerway-payment-showcase.vercel.app/api/webhooks/onerway/payment'
const PATH = '/onerway/payment'
const MAX_BYTES = 64 * 1024
const TIMEOUT_MS = 15_000

function reply(status, body) {
  return new Response(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    },
  })
}

async function readBody(request) {
  const length = request.headers.get('content-length')

  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) {
    return null
  }

  if (!request.body) {
    return new Uint8Array()
  }

  const reader = request.body.getReader()
  const chunks = []
  let bytes = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    bytes += value.byteLength

    if (bytes > MAX_BYTES) {
      await reader.cancel().catch(() => {})
      return null
    }

    chunks.push(value)
  }

  const body = new Uint8Array(bytes)
  let offset = 0

  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return body
}

const worker = {
  async fetch(request) {
    const url = new URL(request.url)

    if (request.method !== 'POST' || url.pathname !== PATH || url.search) {
      return reply(404, 'Not Found')
    }

    const contentType = request.headers.get('content-type')

    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      return reply(415, 'Unsupported Media Type')
    }

    let body

    try {
      body = await readBody(request)
    }
    catch {
      return reply(400, 'Bad Request')
    }

    if (body === null) {
      return reply(413, 'Payload Too Large')
    }

    let upstream

    try {
      upstream = await fetch(UPSTREAM, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    }
    catch {
      return reply(502, 'Bad Gateway')
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'cache-control': 'no-store',
        'content-type': upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8',
      },
    })
  },
}

export default worker
