import sharp from 'sharp'
import { defaultMaterialIcon, materialIcons } from './materialIcons.js'

const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }) }
export const maxMaterialPhotoBytes = 48000

export async function inventoryAppearance(body) {
  const result = {}
  if (Object.hasOwn(body, 'icon')) {
    if (!materialIcons.some((icon) => icon.key === body.icon)) fail('Selecione um ícone válido para o material.')
    result.icon = body.icon
  }
  if (!Object.hasOwn(body, 'photo')) return result
  if (body.photo === null) return { ...result, photo: null }
  if (typeof body.photo !== 'string' || body.photo.length > maxMaterialPhotoBytes * 4 / 3 + 50) fail('A foto excede o tamanho permitido.')
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.photo)
  if (!match) fail('Envie uma imagem JPG, PNG ou WebP válida.')
  const input = Buffer.from(match[2], 'base64')
  if (input.length > maxMaterialPhotoBytes || input.toString('base64') !== match[2]) fail('A foto excede o tamanho permitido ou está inválida.')
  try {
    const metadata = await sharp(input, { limitInputPixels: 16777216 }).metadata()
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) > 1) fail('Envie uma foto estática JPG, PNG ou WebP.')
    const output = await sharp(input, { limitInputPixels: 16777216 }).rotate().resize(256, 256, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 70, effort: 4 }).toBuffer()
    if (output.length > maxMaterialPhotoBytes) fail('Não foi possível reduzir a foto. Escolha outra imagem.')
    result.photo = `data:image/webp;base64,${output.toString('base64')}`
    return result
  } catch (error) {
    if (error.status === 400) throw error
    fail('Não foi possível abrir esta foto. Escolha uma imagem JPG, PNG ou WebP válida.')
  }
}

export async function ensureInventoryAppearance(pool) {
  const [columns] = await pool.execute("SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_materials'")
  const names = new Set(columns.map((column) => column.name))
  if (!names.size) throw new Error('Prepare o banco de dados com npm run db:setup antes de iniciar o portal.')
  // `unit` came with the materials counted by unit (un) or metre (m) besides kilos (kg): existing materials stay in kg.
  for (const [name, definition] of [['icon', `VARCHAR(24) NOT NULL DEFAULT '${defaultMaterialIcon}'`], ['photo', 'TEXT NULL'], ['unit', "VARCHAR(4) NOT NULL DEFAULT 'kg'"]]) {
    if (names.has(name)) continue
    try { await pool.execute(`ALTER TABLE inventory_materials ADD COLUMN ${name} ${definition}`) }
    catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error }
  }
}
