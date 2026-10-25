import { useEffect, useId, useState } from 'react'
import { payableRequest } from './payablesApi.js'

// Sectors are only marked, from Cadastros > Setores (read when the window opens, so a sector just created is there).
// Machines and services keep the names (`by="name"`), employees the ids (`by="id"`). A name kept by a machine but no
// longer registered still shows, so it is not lost by saving.
export default function SectorPicker({ value = [], onChange, by = 'name', error = '', hint = 'Marque um ou mais setores. Para criar um setor novo, use Cadastros › Setores.' }) {
  const [registered, setRegistered] = useState(null)
  const id = useId()
  useEffect(() => {
    let active = true
    payableRequest('/sectors').then((data) => { if (active) setRegistered(data.items) }).catch(() => { if (active) setRegistered([]) })
    return () => { active = false }
  }, [])
  const options = (registered || []).map((sector) => ({ key: by === 'id' ? sector.id : sector.name, name: sector.name }))
  if (by === 'name') for (const name of value) if (!options.some((option) => option.key === name)) options.push({ key: name, name })
  const toggle = (key) => onChange(value.includes(key) ? value.filter((item) => item !== key) : [...value, key])
  return <div className="machine-sector-picker" role="group" aria-labelledby={`${id}-title`} aria-describedby={`${id}-hint`}>
    <span className="machine-sector-title" id={`${id}-title`}>Setor</span>
    {registered === null ? <p className="machine-sector-empty">Carregando setores...</p>
      : options.length ? <div className="machine-sector-options">{options.map((option) => <button key={option.key} type="button" aria-pressed={value.includes(option.key)} onClick={() => toggle(option.key)}>{option.name}</button>)}</div>
      : <p className="machine-sector-empty">Nenhum setor cadastrado.</p>}
    <small id={`${id}-hint`}>{hint}</small>
    {error && <p className="workflow-error" role="alert">{error}</p>}
  </div>
}
