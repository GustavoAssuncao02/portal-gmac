// Calculadora de pesos e medidas: materials, formats and the weight formulas, shared by the screen and the Início widget.
export const calculatorMaterials = [
  { key: 'carbon', name: 'Aço Carbono', density: 8 },
  { key: 'stainless', name: 'Aço Inox', density: 8 },
  { key: 'aluminum', name: 'Alumínio', density: 2.75 },
  { key: 'bronze', name: 'Bronze', density: 9 },
  { key: 'copper', name: 'Cobre', density: 9 },
  { key: 'brass', name: 'Latão', density: 8.7 },
]

const conversionFractions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32]
export const conversionOptions = Array.from({ length: 24 }, (_, whole) => conversionFractions
    .filter((fraction) => whole < 23 || fraction < 32)
    .map((fraction) => whole * 32 + fraction))
  .flat()
  .map((numerator, index) => {
  const whole = Math.floor(numerator / 32)
  const remainder = numerator % 32
  const greatestCommonDivisor = (a, b) => (b ? greatestCommonDivisor(b, a % b) : a)
  const divisor = remainder ? greatestCommonDivisor(remainder, 32) : 1
  const fraction = remainder ? `${remainder / divisor}/${32 / divisor}` : ''
  const inchLabel = whole ? (fraction ? `${whole}.${fraction}` : `${whole}`) : fraction
  const millimeter = Number(((numerator / 32) * 25.4).toFixed(2))
  return { key: String(index), inchLabel, millimeter, millimeterLabel: millimeter.toFixed(2).replace('.', ',') }
})

export const calculatorFormats = [
  { key: 'flat', name: 'Barra Chata', icon: '▱', materials: ['carbon', 'stainless', 'bronze', 'copper'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['width', 'Largura']] },
  { key: 'square', name: 'Barra Quadrada', icon: '◇', materials: ['carbon', 'stainless', 'aluminum', 'copper', 'bronze'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['side', 'Lado']] },
  { key: 'round', name: 'Barra Redonda', icon: '◉', materials: ['carbon', 'stainless', 'aluminum', 'copper'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['diameter', 'Diâmetro']] },
  { key: 'rectangular', name: 'Barra Retangular', icon: '▰', materials: ['copper', 'brass', 'aluminum'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['width', 'Largura']] },
  { key: 'hex', name: 'Barra Sextavada', icon: '⬡', materials: ['carbon', 'stainless', 'aluminum', 'copper'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['side', 'Altura']] },
  { key: 'coil', name: 'Bobina', icon: '◎', materials: ['carbon', 'stainless', 'aluminum', 'copper', 'brass', 'bronze'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['width', 'Largura']] },
  { key: 'bushing', name: 'Bucha', icon: '◉', materials: ['bronze'], resultLabel: 'peça com 500 mm', resultUnit: 'kg', fields: [['outerDiameter', 'Diâmetro externo'], ['innerDiameter', 'Diâmetro interno']] },
  { key: 'plate', name: 'Chapa', icon: '▱', materials: ['carbon', 'stainless', 'aluminum', 'copper', 'brass', 'bronze'], resultLabel: 'peça', resultUnit: 'kg', fields: [['thickness', 'Espessura'], ['width', 'Largura'], ['length', 'Comprimento']] },
  { key: 'checkered', name: 'Chapa Xadrez', icon: '▤', materials: ['carbon', 'aluminum'], resultLabel: 'peça', resultUnit: 'kg', fields: [['thickness', 'Espessura'], ['width', 'Largura'], ['length', 'Comprimento']] },
  { key: 'angle', name: 'Perfil L', icon: '⌞', materials: ['carbon', 'stainless', 'aluminum'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['width', 'Largura']] },
  { key: 'tee', name: 'Perfil T', icon: '⊥', materials: ['aluminum'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['width', 'Largura']] },
  { key: 'channel', name: 'Perfil U', icon: '∪', materials: ['carbon', 'aluminum'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['width', 'Largura']] },
  { key: 'unequalChannel', name: 'Perfil U (abas desiguais) / dobrado', icon: '∪', materials: ['carbon'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['base', 'Base'], ['flangeLarge', 'Aba maior'], ['flangeSmall', 'Aba menor']] },
  { key: 'billet', name: 'Tarugo', icon: '▣', materials: ['bronze'], resultLabel: 'peça com 500 mm', resultUnit: 'kg', fields: [['diameter', 'Diâmetro']] },
  { key: 'squareTube', name: 'Tubo Quadrado', icon: '□', materials: ['carbon', 'aluminum', 'copper', 'brass'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['side', 'Lado']] },
  { key: 'roundTube', name: 'Tubo Redondo', icon: '◎', materials: ['carbon', 'stainless', 'aluminum', 'copper', 'brass', 'bronze'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['diameter', 'Diâmetro']] },
  { key: 'rectangularTube', name: 'Tubo Retangular', icon: '▭', materials: ['carbon', 'stainless', 'aluminum', 'copper', 'brass'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['sideOne', 'Lado 1'], ['sideTwo', 'Lado 2']] },
  { key: 'scheduleTube', name: 'Tubo Schedule', icon: '◎', materials: ['carbon', 'stainless', 'aluminum'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['thickness', 'Espessura'], ['diameter', 'Diâmetro']] },
  { key: 'squareRebar', name: 'Vergalhão Quadrado', icon: '□', materials: ['brass'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['side', 'Lado']] },
  { key: 'roundRebar', name: 'Vergalhão Redondo', icon: '◉', materials: ['stainless', 'brass'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['diameter', 'Diâmetro']] },
  { key: 'hexRebar', name: 'Vergalhão Sextavado', icon: '⬡', materials: ['brass'], resultLabel: 'metro', resultUnit: 'kg/m', fields: [['side', 'Distância']] },
]

export function calculatorVolume(format, values) {
  const n = (field) => Number(values[field]) || 0
  const t = n('thickness')
  const w = n('width')
  const h = n('height')
  const d = n('diameter')
  const s = n('side')
  const outer = n('outerDiameter')
  const inner = n('innerDiameter')
  const length = n('length')
  const sideOne = n('sideOne')
  const sideTwo = n('sideTwo')
  switch (format) {
    case 'flat':
    case 'rectangular':
    case 'coil': return (t * w) / 1000
    case 'plate': return (t * w * length) / 1000000
    case 'checkered': return ((t * w * length) / 1000000) * 1.1
    case 'square':
    case 'squareRebar': return (s ** 2) / 1000
    case 'round':
    case 'roundRebar': return (d ** 2 * 0.7854) / 1000
    case 'hex':
    case 'hexRebar': return (s ** 2 * 0.866) / 1000
    case 'bushing': return outer > inner ? ((outer + 1.58) ** 2 - (inner - 1.58) ** 2) * 0.003534 : 0
    case 'billet': return d ? ((d + 1.58) ** 2 * 0.7854) / 2000 : 0
    case 'angle':
    case 'tee': return (2 * w * t - t ** 2) / 1000
    case 'channel': return (3 * w * t - 2 * t ** 2) / 1000
    case 'unequalChannel': return ((n('base') + n('flangeLarge') + n('flangeSmall')) * t) / 1000
    case 'squareTube': return s > (2 * t) ? ((2 * s - 2 * t) * 2 * t) / 1000 : 0
    case 'roundTube':
    case 'scheduleTube': return (Math.PI * t * (d - t)) / 1000
    case 'rectangularTube': return sideOne > (2 * t) && sideTwo > (2 * t) ? ((sideOne + sideTwo - (2 * t)) * 2 * t) / 1000 : 0
    default: return 0
  }
}

export function calculatorWeight(format, material, values) {
  const volume = calculatorVolume(format, values)
  return format === 'bushing' ? volume : volume * material.density
}
