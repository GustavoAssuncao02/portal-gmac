// Medida da quantidade de uma oferta e da sua OS (TCK-0009): unidades, pares ou conjuntos. O número continua sendo o que
// a produção conta (as telas de produção seguem falando em peças); a medida muda só como a quantidade é escrita: por
// extenso nas telas ("2 pares"), abreviada nos PDFs da proposta ("Par"). Ofertas e OS de antes não têm o campo e valem
// como unidades. Shared by the server and the screens (no Node imports here).
export const quantityUnits = [['un', 'Unidades'], ['par', 'Pares'], ['cj', 'Conjuntos']]
const words = {
  un: { one: 'unidade', many: 'unidades', short: 'un', pdf: 'Un' },
  par: { one: 'par', many: 'pares', short: 'par', pdf: 'Par' },
  cj: { one: 'conjunto', many: 'conjuntos', short: 'cj', pdf: 'Cj' },
}
export const quantityUnitMessage = 'Escolha a medida da quantidade: unidades, pares ou conjuntos.'

export const quantityUnitOf = (value) => (Object.hasOwn(words, value) ? value : 'un')
// Blank (or not sent) means unidades, as before.
export const validQuantityUnit = (value) => value == null || value === '' || Object.hasOwn(words, value)
// "1 par", "2 pares"; `short` gives the abbreviation of the lists ("2 un", "2 cj").
export const quantityWord = (quantity, unit, { short = false } = {}) => {
  const word = words[quantityUnitOf(unit)]
  if (short) return word.short === 'par' && Number(quantity) !== 1 ? 'pares' : word.short
  return Number(quantity) === 1 ? word.one : word.many
}
export const quantityLabel = (quantity, unit, options) => `${quantity} ${quantityWord(quantity, unit, options)}`
// What the proposal PDFs print in their unit column or after the quantity.
export const quantityUnitPdf = (unit) => words[quantityUnitOf(unit)].pdf
