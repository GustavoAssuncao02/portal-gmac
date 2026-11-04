import { useId } from 'react'
import { entryModes } from '../server/entryMode.js'

// "Forma de lançamento": materials and times typed per piece or for the whole order, in the offer and in the OS.
export default function EntryModeChoice({ value, onChange, disabled }) {
  const name = useId()
  return <fieldset className="offer-entry-mode" disabled={disabled}>
    <legend>Forma de lançamento</legend>
    <div className="offer-kind-options">{entryModes.map(([key, label]) => <label key={key}><input type="radio" name={name} checked={value === key} onChange={() => onChange(key)} />{label}</label>)}</div>
    <p>{entryModes.find(([key]) => key === value)?.[2]}</p>
  </fieldset>
}
