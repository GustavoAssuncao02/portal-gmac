// Anotações e Tarefas (2026-11-24): the rules shared by the server (notes.js) and the screens (NotesScreen.jsx,
// NotesButton.jsx). Dates are the days of Bahia (UTC-3 all year, no daylight saving), as everywhere in the portal.
export const TITLE_MAX = 120
export const TEXT_MAX = 5000
export const PLACE_MAX = 200
export const CHECKLIST_MAX = 50
export const CHECKLIST_TEXT_MAX = 200
export const COMMENT_MAX = 1000
export const SHARE_MAX = 20

export const noteColors = [['yellow', 'Amarela'], ['blue', 'Azul'], ['green', 'Verde'], ['pink', 'Rosa']]
export const taskTypes = [['task', 'Tarefa'], ['meeting', 'Reunião']]
export const taskPriorities = [['normal', 'Normal'], ['high', 'Alta']]
export const taskRepeats = [['none', 'Não repete'], ['daily', 'Todo dia'], ['weekly', 'Toda semana'], ['monthly', 'Todo mês']]
// Each person's own reminder of a task, in minutes before it. A task without a time counts from 08:00 of its day.
export const taskReminders = [['none', 'Sem lembrete'], ['0', 'Na hora'], ['15', '15 minutos antes'], ['60', '1 hora antes'], ['1440', '1 dia antes']]
export const defaultReminder = '60'
// "Notificar tarefa próxima do prazo" (Configurações): how many days before the day of the task, at 07:30 (the company
// starts at 07:30; until 2026-11-26 it was 08:00). The reminder of a task without a time still counts from 08:00.
export const dueNoticeDays = [1, 2, 3, 5, 7]
export const dueNoticeTime = '07:30'
export const untimedMoment = '08:00'

export const labelOf = (list, key) => list.find(([value]) => value === key)?.[1] || ''
export const linkPattern = /^(OS|OF)-\d{4}-\d{4,}$/

const OFFSET_MS = 3 * 3600000
const DAY_MS = 86400000
const pad = (value) => String(value).padStart(2, '0')
// The day and the time of Bahia of a moment (milliseconds).
export const bahiaDay = (ms) => new Date(ms - OFFSET_MS).toISOString().slice(0, 10)
export const bahiaClock = (ms) => new Date(ms - OFFSET_MS).toISOString().slice(11, 16)
export const momentOf = (date, time = '00:00') => Date.parse(`${date}T${time || '00:00'}:00.000-03:00`)
export const addDays = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
export const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
export const validTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)

// The moment of a task: its day and time, or 08:00 of the day when it has no time.
export const dueMoment = (task) => task.dueDate ? momentOf(task.dueDate, task.dueTime || untimedMoment) : null
// Late: past its time; a task without a time is late only from the next day on.
export function isLate(task, now) {
  if (!task.dueDate) return false
  return task.dueTime ? now > momentOf(task.dueDate, task.dueTime) : bahiaDay(now) > task.dueDate
}
// The groups of the list of tasks, in this order.
export const taskGroups = [['late', 'Atrasadas'], ['today', 'Hoje'], ['upcoming', 'Próximos dias'], ['nodate', 'Sem data'], ['done', 'Concluídas']]
export function taskGroup(task, done, now) {
  if (done) return 'done'
  if (!task.dueDate) return 'nodate'
  if (isLate(task, now)) return 'late'
  return task.dueDate === bahiaDay(now) ? 'today' : 'upcoming'
}

const weekdays = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
// "hoje, 16:00", "amanhã", "qui, 26/11 · 09:00", "seg, 04/01/2027".
export function dueLabel(task, now) {
  if (!task?.dueDate) return 'Sem data'
  const today = bahiaDay(now), [year, month, day] = task.dueDate.split('-')
  const relative = { [today]: 'hoje', [addDays(today, -1)]: 'ontem', [addDays(today, 1)]: 'amanhã' }[task.dueDate]
  const weekday = weekdays[new Date(`${task.dueDate}T12:00:00Z`).getUTCDay()]
  const date = relative || `${weekday}, ${day}/${month}${year !== today.slice(0, 4) ? `/${year}` : ''}`
  return task.dueTime ? `${date}${relative ? ',' : ' ·'} ${task.dueTime}` : date
}
export const dateLabel = (date) => date ? date.split('-').reverse().join('/') : ''

// The next day of a repeated task, never before today. A monthly task keeps its day of the month (`anchor`), or the last
// day of a shorter month.
export function nextOccurrence(date, repeat, today, anchor) {
  const step = (value) => {
    if (repeat === 'daily') return addDays(value, 1)
    if (repeat === 'weekly') return addDays(value, 7)
    const [year, month] = value.split('-').map(Number)
    const nextYear = month === 12 ? year + 1 : year, nextMonth = month === 12 ? 1 : month + 1
    const last = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate()
    return `${nextYear}-${pad(nextMonth)}-${pad(Math.min(Number(anchor) || Number(value.slice(8)), last))}`
  }
  let next = step(date)
  while (next < today) next = step(next)
  return next
}
// The next days of a repeated task from `from` to `to`, after its current day (Tarefas › Calendário shows them lighter).
export function occurrencesBetween(task, from, to) {
  if (!task?.dueDate || !task.repeat || task.repeat === 'none') return []
  const days = []
  for (let day = nextOccurrence(task.dueDate, task.repeat, addDays(task.dueDate, 1), task.repeatAnchor); day <= to; day = nextOccurrence(day, task.repeat, addDays(day, 1), task.repeatAnchor)) if (day >= from) days.push(day)
  return days
}

// Accent-free lower case, for the search.
export const plain = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export const kindWord = (kind) => kind === 'task' ? 'tarefa' : 'anotação'
