/** Cloudflare tunnel helper (D3), pure parts only: URL parsing and release asset mapping. No network, no spawn. */
import { describe, it, expect } from 'vitest'
import { cloudflaredAsset, parseTunnelUrl } from './tunnel'

describe('parseTunnelUrl', () => {
  it('finds the trycloudflare URL in the boxed banner and in log lines (stdout or stderr), lower-cased', () => {
    expect(parseTunnelUrl('2026-10-15T10:00:00Z INF |  https://wide-rows-mean-ok.trycloudflare.com                                           |')).toBe('https://wide-rows-mean-ok.trycloudflare.com')
    expect(parseTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...')).toBeNull()
    expect(parseTunnelUrl('+--------------------------------------------------------------------------------------------+')).toBeNull()
    expect(parseTunnelUrl('Visit it at (it may take some time to be reachable): https://Some-Name-123.trycloudflare.com')).toBe('https://some-name-123.trycloudflare.com')
    expect(parseTunnelUrl('https://api.trycloudflare.com/tunnel')).toBe('https://api.trycloudflare.com')
  })

  it('ignores other hosts and non-https', () => {
    expect(parseTunnelUrl('http://abc.trycloudflare.com')).toBeNull()
    expect(parseTunnelUrl('https://abc.trycloudflare.com.evil.example')).toBe('https://abc.trycloudflare.com') // the real host part is what matters
    expect(parseTunnelUrl('https://example.com')).toBeNull()
    expect(parseTunnelUrl('')).toBeNull()
  })
})

describe('cloudflaredAsset', () => {
  it('maps platform / arch to the GitHub release asset, the installed file name and the archive kind', () => {
    expect(cloudflaredAsset('win32', 'x64')).toEqual({
      asset: 'cloudflared-windows-amd64.exe',
      url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
      file: 'cloudflared.exe',
      archive: 'none',
    })
    expect(cloudflaredAsset('win32', 'ia32')!.asset).toBe('cloudflared-windows-386.exe')
    expect(cloudflaredAsset('darwin', 'x64')).toMatchObject({ asset: 'cloudflared-darwin-amd64.tgz', file: 'cloudflared', archive: 'tgz' })
    expect(cloudflaredAsset('darwin', 'arm64')).toMatchObject({ asset: 'cloudflared-darwin-arm64.tgz', archive: 'tgz' })
    expect(cloudflaredAsset('linux', 'x64')).toMatchObject({ asset: 'cloudflared-linux-amd64', file: 'cloudflared', archive: 'none' })
    expect(cloudflaredAsset('linux', 'arm64')!.asset).toBe('cloudflared-linux-arm64')
    expect(cloudflaredAsset('linux', 'arm')!.asset).toBe('cloudflared-linux-arm')
  })

  it('returns null for unsupported combinations', () => {
    expect(cloudflaredAsset('win32', 'arm64')).toBeNull()
    expect(cloudflaredAsset('darwin', 'ia32')).toBeNull()
    expect(cloudflaredAsset('freebsd', 'x64')).toBeNull()
    expect(cloudflaredAsset('linux', 'mips')).toBeNull()
  })
})
