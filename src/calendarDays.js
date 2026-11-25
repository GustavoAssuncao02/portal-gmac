// The days of the portal's calendars (Planejamento › Entregas, Anotações e Tarefas › Calendário). Weeks start on Sunday
// (the user's choice of 2026-11-24). Days are 'YYYY-MM-DD' and months 'YYYY-MM', counted at noon UTC so no time zone or
// summer time moves a day.
const DAY_MS = 86400000
export const calendarWeekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
export const shiftDay = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
export const sundayOf = (date) => shiftDay(date, -new Date(`${date}T12:00:00Z`).getUTCDay())
export const weekOf = (date) => Array.from({ length: 7 }, (_, index) => shiftDay(sundayOf(date), index))
export const shiftMonth = (month, months) => { const [year, number] = month.split('-').map(Number); return new Date(Date.UTC(year, number - 1 + months, 1, 12)).toISOString().slice(0, 7) }
export const lastDayOf = (month) => { const [year, number] = month.split('-').map(Number); return new Date(Date.UTC(year, number, 0, 12)).toISOString().slice(0, 10) }

// The weeks that show a month: from the Sunday on or before the 1st to the Saturday on or after its last day.
export function monthDays(month) {
  const days = []
  for (let day = sundayOf(`${month}-01`), end = shiftDay(sundayOf(lastDayOf(month)), 6); day <= end; day = shiftDay(day, 1)) days.push(day)
  return days
}

const format = (date, options) => new Date(`${date}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', ...options })
// "novembro de 2026", "terça-feira, 24 de novembro", "22/11 a 28/11".
export const monthTitle = (month) => format(`${month}-01`, { month: 'long', year: 'numeric' })
export const shortMonth = (month) => format(`${month}-01`, { month: 'short', year: 'numeric' }).replace('.', '').replace(' de ', ' ')
export const dayTitle = (date) => format(date, { weekday: 'long', day: 'numeric', month: 'long' })
export const shortDay = (date) => date.split('-').reverse().slice(0, 2).join('/')
export const weekTitle = (date) => { const days = weekOf(date); return `${shortDay(days[0])} a ${shortDay(days[6])}` }
