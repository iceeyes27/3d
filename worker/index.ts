const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...init.headers,
    },
  })

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json(
          { error: 'Method not allowed' },
          { status: 405, headers: { allow: 'GET, HEAD' } },
        )
      }

      return json({ ok: true, service: 'maker-island', version: '0.1.0' })
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, { status: 404 })
    }

    return json({ error: 'Not found' }, { status: 404 })
  },
} satisfies { fetch(request: Request): Promise<Response> }
