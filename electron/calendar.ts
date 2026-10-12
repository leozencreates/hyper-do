/**
 * Google login for the desktop app: PKCE authorization-code flow with a loopback redirect.
 * Opens the system browser, listens once on http://127.0.0.1:<random port>/callback, exchanges the code.
 * Matches Google's "Desktop app" OAuth client type.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { shell } from 'electron'
import { buildAuthUrl, exchangeCode, pkcePair, randomToken, type GoogleTokens } from '../src/lib/gcal'

const LOGIN_TIMEOUT_MS = 5 * 60_000

function resultPage(ok: boolean, text: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Hyper Do</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;font-family:'Segoe UI',system-ui,sans-serif;background:#0f1117;color:#e6e9f0}
.card{max-width:420px;padding:32px 36px;border-radius:16px;background:#161a23;border:1px solid #2a3140;text-align:center;border-top:3px solid ${ok ? '#4fd18b' : '#ff5c6c'}}
h1{font-size:22px;margin:0 0 10px;background:linear-gradient(135deg,#ff8a3d,#ff5fa2 55%,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent}
p{margin:0;color:#9aa3b5;line-height:1.5}</style></head>
<body><div class="card"><h1>${ok ? '✓ Hyper Do' : 'Hyper Do'}</h1><p>${text}</p></div><script>setTimeout(()=>window.close(),4000)</script></body></html>`
}

let inProgress = false

export async function googleLoginDesktop(clientId: string, clientSecret: string, texts: { ok: string; fail: string }): Promise<GoogleTokens> {
  if (inProgress) throw new Error('busy')
  inProgress = true
  const server = http.createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const port = (server.address() as AddressInfo).port
    const redirectUri = `http://127.0.0.1:${port}/callback`
    const { verifier, challenge } = await pkcePair()
    const state = randomToken(16)

    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), LOGIN_TIMEOUT_MS)
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirectUri)
        if (url.pathname !== '/callback') {
          res.writeHead(404).end()
          return
        }
        const err = url.searchParams.get('error')
        const got = url.searchParams.get('code')
        const st = url.searchParams.get('state')
        const ok = !err && !!got && st === state
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(resultPage(ok, ok ? texts.ok : texts.fail))
        clearTimeout(timer)
        if (err) reject(new Error(err))
        else if (!ok) reject(new Error('state_mismatch'))
        else resolve(got!)
      })
      void shell.openExternal(buildAuthUrl({ clientId, redirectUri, challenge, state }))
    })

    return await exchangeCode({ clientId, clientSecret, code, verifier, redirectUri })
  } finally {
    server.close()
    inProgress = false
  }
}
