import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../frontend/public/sw.js', import.meta.url), 'utf8')

function worker(hostname = 'hostel.example') {
  const handlers = {}, deleted = [], matches = []
  const offlinePage = new Response('<html>Offline</html>', { headers: { 'content-type': 'text/html' } })
  const context = {
    self: { location: { hostname, origin: `https://${hostname}` },
      addEventListener: (name, handler) => { handlers[name] = handler },
      skipWaiting() {}, clients: { claim() {} } },
    caches: {
      keys: async () => ['hostel-pwa-v1', 'hostel-pwa-v2', 'another-app-cache'],
      delete: async (key) => { deleted.push(key) },
      open: async () => ({
        addAll: async () => {},
        match: async (key) => { matches.push(key); return key === '/' ? offlinePage : undefined },
      }),
    },
    fetch: async () => { throw new TypeError('Network unavailable') }, URL, Response,
  }
  vm.runInNewContext(source, context)
  return { handlers, deleted, matches, offlinePage, origin: context.self.location.origin }
}

test('offline scripts, styles and API requests never receive the HTML fallback', () => {
  const { handlers, origin, matches } = worker()
  for (const path of ['/src/main.jsx', '/assets/app.js', '/assets/app.css', '/api/rooms']) {
    let intercepted = false
    handlers.fetch({ request: { method: 'GET', url: `${origin}${path}`, mode: 'cors' },
      respondWith() { intercepted = true } })
    assert.equal(intercepted, false, path)
  }
  assert.equal(matches.length, 0)
})

test('offline page navigation can use the current app shell', async () => {
  const { handlers, origin, offlinePage } = worker()
  let response
  handlers.fetch({ request: { method: 'GET', url: `${origin}/rooms`, mode: 'navigate' },
    respondWith(value) { response = value } })
  assert.equal(await response, offlinePage)
})

test('local development workers never intercept page or module requests', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    const { handlers, origin } = worker(hostname)
    for (const mode of ['navigate', 'cors']) {
      handlers.fetch({ request: { method: 'GET', url: `${origin}/`, mode },
        respondWith() { assert.fail('Local development must use the server response') } })
    }
  }
})

test('activation clears old Hostel caches while preserving other apps and the current production cache', async () => {
  for (const hostname of ['hostel.example', 'localhost']) {
    const { handlers, deleted } = worker(hostname)
    let activation
    handlers.activate({ waitUntil(value) { activation = value } })
    await activation
    assert.deepEqual(deleted, hostname === 'localhost' ? ['hostel-pwa-v1', 'hostel-pwa-v2'] : ['hostel-pwa-v1'])
  }
})
