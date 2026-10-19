// After `npm run dist`: electron-builder writes to %LOCALAPPDATA%\hyperdo-release (building under Desktop fails),
// so copy the finished installer into the repo's git-ignored release/ folder for easy access.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const name = `Hyper-Do-Setup-${version}.exe`
const src = join(process.env.LOCALAPPDATA ?? '', 'hyperdo-release', name)

if (!existsSync(src)) {
  console.error(`copy-release: ${src} not found`)
  process.exit(1)
}
const outDir = join(root, 'release')
mkdirSync(outDir, { recursive: true })
copyFileSync(src, join(outDir, name))
console.log(`copy-release: ${name} → ${outDir}`)
