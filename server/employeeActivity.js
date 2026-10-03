const dayMs = 86400000

export function activityDateRange(period = 'today', date, now = Date.now()) {
  if (period === 'all') return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const today = Date.parse(`${values.year}-${values.month}-${values.day}T00:00:00-03:00`)
  if (period === 'date') {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('Informe uma data válida.')
    const parsed = new Date(`${date}T00:00:00Z`)
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new RangeError('Informe uma data válida.')
    const start = Date.parse(`${date}T00:00:00-03:00`)
    return { start, end: start + dayMs }
  }
  const offsets = { today: [0, 1], yesterday: [-1, 0], '7days': [-6, 1], '30days': [-29, 1] }
  const offset = Object.hasOwn(offsets, period) ? offsets[period] : null
  if (!offset) throw new RangeError('Selecione um período válido.')
  return { start: today + offset[0] * dayMs, end: today + offset[1] * dayMs }
}
