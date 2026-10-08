import { useEffect, useRef, useState } from 'react'

// Accepts how people type money in Brazil (1.234,56 · 1234,56 · R$ 1234) and also 1234.56.
// Returns the API format "1234.56", "" when empty, or null when the text is not a value.
export function parseMoney(text) {
  const value = String(text ?? '').replace(/r\$/gi, '').replace(/\s/g, '')
  if (!value) return ''
  if (!/^\d[\d.,]*$/.test(value)) return null
  let whole = value, fraction = ''
  if (value.includes(',')) {
    if (value.indexOf(',') !== value.lastIndexOf(',')) return null
    ;[whole, fraction] = value.split(',')
    if (whole.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(whole)) return null
    whole = whole.replace(/\./g, '')
  } else if (value.includes('.')) {
    const parts = value.split('.')
    if (parts.length === 2 && parts[1].length <= 2) [whole, fraction] = parts
    else if (/^\d{1,3}(\.\d{3})+$/.test(value)) whole = value.replace(/\./g, '')
    else return null
  }
  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(fraction)) return null
  return `${BigInt(whole)}.${fraction.padEnd(2, '0')}`
}
export function formatMoney(api) {
  if (!api) return ''
  const [whole, fraction = '00'] = String(api).split('.')
  return `${BigInt(whole).toLocaleString('pt-BR')},${fraction.padEnd(2, '0').slice(0, 2)}`
}

export default function MoneyInput({ value, onChange, positive = false, ...props }) {
  const [text, setText] = useState(() => formatMoney(value))
  const input = useRef(null)
  useEffect(() => { if (parseMoney(text) !== (value || '')) setText(formatMoney(value)) }, [value])
  useEffect(() => {
    const parsed = parseMoney(text)
    input.current.setCustomValidity(parsed === null ? 'Informe um valor como 1.234,56.' : positive && parsed !== '' && Number(parsed) <= 0 ? 'O valor deve ser maior que zero.' : '')
  }, [text, positive])
  return <span className="money-input"><span aria-hidden="true">R$</span><input ref={input} type="text" inputMode="decimal" autoComplete="off" {...props} value={text} onChange={(event) => { setText(event.target.value); const parsed = parseMoney(event.target.value); onChange(parsed ?? '') }} onBlur={() => { const parsed = parseMoney(text); if (parsed) setText(formatMoney(parsed)) }} /></span>
}
