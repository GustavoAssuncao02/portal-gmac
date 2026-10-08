// Builds the login background media from a source folder (default: ./Midia).
// Photos are resized to WebP (they are shown blurred, so 1280px is plenty); videos are copied as-is.
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.resolve(root, process.argv[2] || 'Midia')
const target = path.join(root, 'public', 'login-media')
const images = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const videos = new Set(['.mp4', '.webm'])

const files = (await readdir(source)).filter((name) => images.has(path.extname(name).toLowerCase()) || videos.has(path.extname(name).toLowerCase())).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
if (!files.length) throw new Error(`Nenhuma imagem ou vídeo encontrado em ${source}.`)
await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
const items = []
let photo = 0, video = 0
for (const name of files) {
  const input = path.join(source, name), extension = path.extname(name).toLowerCase()
  if (images.has(extension)) {
    const output = `foto-${String(++photo).padStart(2, '0')}.webp`
    await sharp(input).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 }).toFile(path.join(target, output))
    items.push({ type: 'image', src: `/login-media/${output}` })
  } else {
    const output = `video-${String(++video).padStart(2, '0')}${extension}`
    await copyFile(input, path.join(target, output))
    items.push({ type: 'video', src: `/login-media/${output}` })
  }
}
await writeFile(path.join(target, 'manifest.json'), `${JSON.stringify({ items }, null, 2)}\n`)
const size = (await Promise.all(items.map((item) => stat(path.join(root, 'public', item.src))))).reduce((total, file) => total + file.size, 0)
console.log(`${photo} fotos e ${video} vídeos gerados em public/login-media (${(size / 1048576).toFixed(1)} MB).`)
