import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { inventoryAppearance, ensureInventoryAppearance, maxMaterialPhotoBytes } from '../server/inventoryAppearance.js'
import { materialIcons, materialIcon } from '../server/materialIcons.js'

test('inventory appearance preserves omitted fields, supports removing photos and validates every icon', async () => {
  assert.equal(materialIcons.length, 14)
  assert.equal(materialIcon('old-icon').key, 'sheet')
  assert.deepEqual(await inventoryAppearance({}), {})
  assert.deepEqual(await inventoryAppearance({ photo: null }), { photo: null })
  for (const icon of materialIcons) assert.deepEqual(await inventoryAppearance({ icon: icon.key }), { icon: icon.key })
  for (const body of [{ icon: 'invalid' }, { photo: 'https://example.com/image.png' }, { photo: 'data:image/svg+xml;base64,PHN2Zy8+' }, { photo: 'data:image/png;base64,AAAA' }, { photo: false }, { photo: 'a'.repeat(65000) }]) {
    await assert.rejects(inventoryAppearance(body), { status: 400 })
  }
})

test('material photos are decoded, resized without distortion and stored only as small metadata-free WebP thumbnails', async () => {
  const original = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#708ca4' } }).jpeg().withMetadata().toBuffer()
  const result = await inventoryAppearance({ icon: 'tube', photo: `data:image/jpeg;base64,${original.toString('base64')}` })
  assert.equal(result.icon, 'tube')
  assert.ok(result.photo.startsWith('data:image/webp;base64,'))
  const bytes = Buffer.from(result.photo.split(',')[1], 'base64')
  const metadata = await sharp(bytes).metadata()
  assert.equal(metadata.width, 256)
  assert.equal(metadata.height, 144)
  assert.ok(bytes.length < original.length && bytes.length <= maxMaterialPhotoBytes)
  assert.equal(metadata.exif, undefined)
  const small = await sharp({ create: { width: 20, height: 10, channels: 4, background: '#ffffff00' } }).png().toBuffer()
  const smallResult = await inventoryAppearance({ photo: `data:image/png;base64,${small.toString('base64')}` })
  assert.equal((await sharp(Buffer.from(smallResult.photo.split(',')[1], 'base64')).metadata()).width, 20)
})

test('appearance schema migration adds only absent columns without replacing materials', async () => {
  const calls = []
  const pool = { async execute(sql) { calls.push(sql); return [[{ name: 'id' }, { name: 'name' }]] } }
  await ensureInventoryAppearance(pool)
  assert.equal(calls.filter((sql) => sql.startsWith('ALTER')).length, 2)
  assert.ok(calls.every((sql) => !/DELETE|DROP|UPDATE|TRUNCATE/.test(sql)))
  calls.length = 0
  pool.execute = async (sql) => { calls.push(sql); return [[{ name: 'id' }, { name: 'icon' }, { name: 'photo' }]] }
  await ensureInventoryAppearance(pool)
  assert.equal(calls.length, 1)
})
