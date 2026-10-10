const units = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove']
const tens = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']
const hundreds = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos']
const scales = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']]

function below1000(value) {
  if (value === 100) return 'cem'
  const parts = []
  if (value >= 100) parts.push(hundreds[Math.floor(value / 100)])
  const rest = value % 100
  if (rest >= 20) parts.push(rest % 10 ? `${tens[Math.floor(rest / 10)]} e ${units[rest % 10]}` : tens[Math.floor(rest / 10)])
  else if (rest) parts.push(units[rest])
  return parts.join(' e ')
}

export function integerInWords(value) {
  let number = Math.floor(Math.abs(Number(value) || 0))
  if (!number) return 'zero'
  const groups = []
  for (let scale = 0; number > 0; scale++, number = Math.floor(number / 1000)) groups.push([number % 1000, scale])
  const spoken = groups.filter(([group]) => group).reverse()
  return spoken.map(([group, scale], index) => {
    const name = scale === 1 && group === 1 ? 'mil' : `${below1000(group)}${scale ? ` ${scales[scale][group === 1 ? 0 : 1]}` : ''}`
    if (!index) return name
    // "mil e cem", "mil e vinte", but "mil duzentos e cinquenta".
    return `${group < 100 || group % 100 === 0 ? 'e ' : ''}${name}`
  }).join(' ')
}

// Brazilian currency in words, as written in commercial proposals: "vinte e dois mil ... reais e trinta e um centavos".
export function moneyInWords(amount) {
  const cents = Math.round(Math.abs(Number(amount) || 0) * 100)
  const reais = Math.floor(cents / 100)
  const centavos = cents % 100
  const parts = []
  if (reais) {
    const words = integerInWords(reais)
    // "um milhão de reais", "dois milhões de reais".
    const ofReais = reais >= 1000000 && reais % 1000000 === 0
    parts.push(`${words}${ofReais ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}`)
  }
  if (centavos) parts.push(`${integerInWords(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`)
  return parts.length ? parts.join(' e ') : 'zero real'
}
