import { useRef, useState } from 'react'
import { Layers, Minus, Cylinder, Columns3, Disc3, Box, Cog, Bolt, Hexagon, Link, Flame, PaintBucket, Disc, Wrench, PenLine, SprayCan, Coffee, SoapDispenserDroplet, CupSoda, Keyboard, Lightbulb, HardHat, BriefcaseMedical, Package, Hammer, Archive, Upload, Trash2, LayoutGrid } from 'lucide-react'
import { iconIn, materialIcons } from '../server/materialIcons.js'

// Factory stock icons and Estoque Administrativo icons (server/materialIcons.js names them).
const icons = { Layers, Minus, Cylinder, Columns3, Disc3, Box, Cog, Bolt, Hexagon, Link, Flame, PaintBucket, Disc, Wrench, PenLine, SprayCan, Coffee, SoapDispenserDroplet, CupSoda, Keyboard, Lightbulb, HardHat, BriefcaseMedical, Package, Hammer, Archive }

export function MaterialVisual({ icon, photo, name = '', className = '', iconSet = materialIcons }) {
  const [failedPhoto, setFailedPhoto] = useState(null)
  const selected = iconIn(iconSet, icon)
  const Symbol = icons[selected.icon]
  return <span className={`material-visual ${className}`}>
    {photo && photo !== failedPhoto ? <img src={photo} alt={`Foto de ${name || 'material'}`} onError={() => setFailedPhoto(photo)} /> : <Symbol size={22} aria-label={selected.label} />}
  </span>
}

export async function reduceMaterialPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Selecione uma foto JPG, PNG ou WebP.')
  if (file.size > 15 * 1024 * 1024) throw new Error('Selecione uma foto de até 15 MB.')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Não foi possível preparar a foto neste navegador.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.72, 0.55, 0.4]) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
      if (!blob || blob.size > 48000) continue
      return await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(new Error('Não foi possível ler a foto.'))
        reader.readAsDataURL(blob)
      })
    }
    throw new Error('Não foi possível reduzir a foto. Selecione outra imagem.')
  } catch (error) {
    if (error.name === 'EncodingError') throw new Error('Não foi possível abrir esta foto. Selecione outra imagem.')
    throw error
  } finally { URL.revokeObjectURL(url) }
}

export default function MaterialAppearance({ value, disabled, processing, onProcessing, onChange, iconSet = materialIcons }) {
  const input = useRef(null)
  const [error, setError] = useState('')
  async function upload(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || disabled || processing) return
    setError('')
    onProcessing(true)
    try { onChange({ photo: await reduceMaterialPhoto(file) }) }
    catch (failure) { setError(failure.message) }
    finally { onProcessing(false) }
  }
  return <fieldset className="material-appearance" disabled={disabled || processing}>
    <legend>Imagem do material</legend>
    <div className="material-appearance-top">
      <MaterialVisual {...value} iconSet={iconSet} className="material-appearance-preview" />
      <div className="material-photo-actions">
        <button type="button" onClick={() => input.current?.click()}><Upload size={16} />{processing ? 'Preparando foto...' : value.photo ? 'Trocar foto' : 'Enviar foto'}</button>
        {value.photo && <button type="button" onClick={() => { setError(''); onChange({ photo: null }) }}><Trash2 size={16} />Remover foto</button>}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Foto personalizada do material" onChange={upload} hidden />
    </div>
    {error && <p className="workflow-error" role="alert">{error}</p>}
    <div className="material-icon-grid" role="group" aria-label="Ícones do material">
      {iconSet.map((item) => {
        const Symbol = icons[item.icon]
        return <button key={item.key} type="button" title={item.label} aria-label={item.label} aria-pressed={!value.photo && iconIn(iconSet, value.icon).key === item.key} onClick={() => { setError(''); onChange({ icon: item.key, photo: null }) }}><Symbol size={21} /><span>{item.label}</span></button>
      })}
    </div>
  </fieldset>
}

// The stock filter: the same tiles as the icon picker (icon over its name), one per icon of the stock plus "Todos", with
// how many materials each has. Used by Estoque and Estoque Administrativo alike.
export function MaterialIconFilter({ iconSet, items, value, onChange }) {
  const count = (key) => items.filter((item) => iconIn(iconSet, item.icon).key === key).length
  return <div className="material-icon-grid material-icon-filter" role="group" aria-label="Filtrar por tipo de material">
    <button type="button" aria-pressed={!value} onClick={() => onChange('')}><LayoutGrid size={21} /><span>Todos</span><small>{items.length}</small></button>
    {iconSet.map((item) => {
      const Symbol = icons[item.icon], total = count(item.key)
      return <button key={item.key} type="button" aria-pressed={value === item.key} className={total ? '' : 'material-icon-filter-empty'} onClick={() => onChange(value === item.key ? '' : item.key)}><Symbol size={21} /><span>{item.label}</span><small>{total}</small></button>
    })}
  </div>
}
