// When each commemorative look of the login screen shows, by the browser's date, every year. The first period of
// the list that contains the day wins (Carnival goes before Women's Day).
// Women's Day, Labor Day and Father's Day show on their day and the day after it; São João, accident prevention,
// Independence and Mother's Day show during the week that ends on them.

const dayNumber = (year, month, day) => Date.UTC(year, month - 1, day) / 86400000

// Easter Sunday (Gregorian calendar, Meeus/Jones/Butcher).
export function easterDay(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1
  return dayNumber(year, month, day)
}

const secondSunday = (year, month) => dayNumber(year, month, 1 + (7 - new Date(Date.UTC(year, month - 1, 1)).getUTCDay()) % 7 + 7)

// [first day, last day] of each look in a given year.
export const seasonPeriods = [
  { id: 'christmas', range: (year) => [dayNumber(year, 12, 1), dayNumber(year, 12, 26)] },
  { id: 'new-year', range: (year) => [dayNumber(year, 12, 27), dayNumber(year + 1, 1, 5)] },
  // From the Friday before Carnival to Ash Wednesday.
  { id: 'carnaval', range: (year) => [easterDay(year) - 51, easterDay(year) - 46] },
  // Holy Week, from Monday to Easter Sunday.
  { id: 'pascoa', range: (year) => [easterDay(year) - 6, easterDay(year)] },
  { id: 'dia-da-mulher', range: (year) => [dayNumber(year, 3, 8), dayNumber(year, 3, 9)] },
  { id: 'dia-do-trabalhador', range: (year) => [dayNumber(year, 5, 1), dayNumber(year, 5, 2)] },
  // Second Sunday of May and the week before it.
  { id: 'dia-das-maes', range: (year) => [secondSunday(year, 5) - 6, secondSunday(year, 5)] },
  { id: 'sao-joao', range: (year) => [dayNumber(year, 6, 18), dayNumber(year, 6, 24)] },
  { id: 'prevencao-acidentes', range: (year) => [dayNumber(year, 7, 21), dayNumber(year, 7, 27)] },
  // Second Sunday of August and the Monday after it.
  { id: 'dia-dos-pais', range: (year) => [secondSunday(year, 8), secondSunday(year, 8) + 1] },
  { id: 'independencia', range: (year) => [dayNumber(year, 9, 1), dayNumber(year, 9, 7)] },
]

export function seasonOn(date = new Date()) {
  const year = date.getFullYear(), today = dayNumber(year, date.getMonth() + 1, date.getDate())
  for (const period of seasonPeriods) {
    // The year before too: the New Year look of December goes into January.
    for (const start of [year - 1, year]) {
      const [first, last] = period.range(start)
      if (today >= first && today <= last) return period.id
    }
  }
  return null
}

// "?tema=<name>" in the address shows a look on any day, to check it beforehand ("?tema=normal" shows none).
// Accents, hyphens and capitals are ignored: "?tema=sao-joao" and "?tema=saojoao" are the same.
const previews = {
  natal: 'christmas', anonovo: 'new-year', carnaval: 'carnaval', pascoa: 'pascoa', diadamulher: 'dia-da-mulher',
  diadotrabalhador: 'dia-do-trabalhador', diadasmaes: 'dia-das-maes', saojoao: 'sao-joao', prevencao: 'prevencao-acidentes',
  prevencaoacidentes: 'prevencao-acidentes', diadospais: 'dia-dos-pais', independencia: 'independencia', normal: null,
}

export function previewName() {
  try {
    const value = new URLSearchParams(window.location.search).get('tema')
    return value == null ? null : value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')
  } catch { return null }
}

export function loginSeason(date = new Date()) {
  const preview = previewName()
  if (preview != null && Object.hasOwn(previews, preview)) return previews[preview]
  return seasonOn(date)
}
