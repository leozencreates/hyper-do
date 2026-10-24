import { expect, it } from 'vitest'
import { buildFullBackup, inspectFullBackup, restoreFullBackup } from './full-backup'
import { normalizeData } from './data'
import { normalizeTask } from './tasks'
import type { MediaApi } from './types'

function store() {
  const files = new Map<string, Blob>()
  const media: MediaApi = { put: async (id, b) => { files.set(id, b) }, get: async (id) => files.get(id) ?? null, gc: async () => 0 }
  return { files, media }
}
const data = () => normalizeData({ tasks: [normalizeTask({ id: 'a', title: 'Photo', attachments: [{ id: 'image', name: 'image.png', mime: 'image/png', kind: 'image', size: 3, addedAt: 1 }] })] })

it('roundtrips tasks and binary media without overwriting existing files', async () => {
  const source = store(); await source.media.put('image', new Blob(['abc'], { type: 'image/png' }))
  const archive = await buildFullBackup(data(), source.media)
  expect((await inspectFullBackup(archive)).data.tasks[0].title).toBe('Photo')
  const target = store(); await target.media.put('image', new Blob(['old']))
  const restored = await restoreFullBackup(archive, target.media)
  const id = restored.tasks[0].attachments[0].id
  expect(id).not.toBe('image')
  expect(await target.files.get(id)!.text()).toBe('abc')
  expect(await target.files.get('image')!.text()).toBe('old')
})
it('refuses an incomplete backup when referenced media is absent', async () => {
  await expect(buildFullBackup(data(), store().media)).rejects.toThrow('missing_media')
})
it('rejects truncated or unrelated files before writing media', async () => {
  const source = store(); await source.media.put('image', new Blob(['abc'], { type: 'image/png' }))
  const archive = await buildFullBackup(data(), source.media)
  const target = store()
  await expect(restoreFullBackup(archive.slice(0, archive.size - 1), target.media)).rejects.toThrow('invalid_backup')
  await expect(inspectFullBackup(new Blob(['not a backup']))).rejects.toThrow('invalid_backup')
  expect(target.files.size).toBe(0)
})
it('roundtrips a backup without media', async () => {
  const source = store()
  const d = normalizeData({ tasks: [normalizeTask({ id: 'plain', firstStep: 'open the file' })] })
  const restored = await restoreFullBackup(await buildFullBackup(d, source.media), source.media)
  expect(restored.tasks).toEqual(d.tasks)
})
