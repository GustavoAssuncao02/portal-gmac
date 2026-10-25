import { readFile, writeFile } from 'node:fs/promises'
import postcss from 'postcss'

const files = ['operator.css', 'employeeActivity.css', 'orderEditing.css', 'orderDetails.css', 'adminHome.css', 'notifications.css', 'adminTools.css', 'payables.css', 'proposalDocuments.css', 'machineHistory.css', 'machineUsage.css', 'planning.css', 'styles.css', 'desktop.css', 'mobile.css']
const allowed = /^(color|background.*|border.*|outline.*|box-shadow|text-shadow|fill|stroke|accent-color|caret-color|text-decoration-color)$/
const bytes = (hex) => {
  const value = hex.slice(1)
  const full = value.length < 5 ? [...value].map((letter) => letter + letter).join('') : value
  return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16) / 255)
}
const hsl = ([r, g, b]) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, light = (max + min) / 2
  const hue = !delta ? 210 : ((max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60)
  return [hue, delta ? delta / (1 - Math.abs(2 * light - 1)) : 0, light]
}
const chromatic = (hue, saturation, light) => {
  const a = saturation * Math.min(light, 1 - light)
  const channel = (n) => { const k = (n + hue / 30) % 12; return Math.round(255 * (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))) }
  return `#${[channel(0), channel(8), channel(4)].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}
function color(hex, property) {
  const [hue, saturation, light] = hsl(bytes(hex))
  const alpha = hex.length === 9 ? hex.slice(7) : hex.length === 5 ? hex[4].repeat(2) : ''
  let result
  if (['color', 'fill', 'stroke', 'caret-color', 'text-decoration-color'].includes(property)) {
    result = light > .94 ? '#f2f6fc' : saturation < .16 ? '#c1cfde' : hue > 175 && hue < 265 ? (light < .33 ? '#e1ebf6' : chromatic(hue, Math.min(saturation, .4), .76)) : chromatic(hue, Math.min(saturation, .72), .73)
  } else if (property.startsWith('border') || property.startsWith('outline')) {
    result = saturation > .55 && light < .6 ? chromatic(hue, .42, .48) : '#36516f'
  } else if (property.includes('shadow')) {
    result = '#06111d'
  } else if (property === 'accent-color') {
    result = '#80b7f0'
  } else if (light > .72) {
    result = saturation < .2 ? (light > .985 ? '#162b43' : '#112239') : hue > 175 && hue < 265 ? '#203c59' : chromatic(hue, .3, .18)
  } else {
    result = saturation < .2 ? '#263e56' : chromatic(hue, Math.min(saturation, .7), Math.min(light, .35))
  }
  return result + alpha
}
function transform(value, property) {
  return value.replace(/#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b/gi, (hex) => color(hex, property))
    .replace(/\b(white|black)\b/g, (named) => color(named === 'white' ? '#ffffff' : '#000000', property))
    .replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/g, (_, r, g, b, alpha) => {
      const hex = `#${[r, g, b].map((value) => Number(value).toString(16).padStart(2, '0')).join('')}`
      return color(hex, property) + (alpha == null ? '' : Math.round(Number(alpha) * 255).toString(16).padStart(2, '0'))
    })
}
const output = postcss.root()
output.append(postcss.comment({ text: 'Generated from the existing CSS color declarations. Run npm run theme:build after changing the base palette.' }))
for (const file of files) {
  const source = postcss.parse(await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8'))
  source.walkRules((rule) => {
    if (rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
    const declarations = rule.nodes.filter((node) => node.type === 'decl' && allowed.test(node.prop)).map((node) => ({ node, value: transform(node.value, node.prop) })).filter(({ node, value }) => node.value !== value)
    if (!declarations.length) return
    const scoped = postcss.rule({ selector: rule.selectors.map((selector) => /^(:root|html)(?=\s|[.#:[>+~]|$)/.test(selector) ? selector.replace(/^(:root|html)/, ':root[data-theme="dark"]') : `:root[data-theme="dark"] ${selector}`).join(', ') })
    for (const { node, value } of declarations) scoped.append({ prop: node.prop, value, important: node.important })
    let child = scoped
    for (let ancestor = rule.parent; ancestor.type !== 'root'; ancestor = ancestor.parent) {
      if (ancestor.type !== 'atrule') continue
      const wrapper = postcss.atRule({ name: ancestor.name, params: ancestor.params })
      wrapper.append(child); child = wrapper
    }
    output.append(child)
  })
}
await writeFile(new URL('../src/darkTheme.generated.css', import.meta.url), `${output.toString()}\n`, 'utf8')
console.log(`Dark palette generated from ${files.length} stylesheets.`)

// "Escuro intenso" is the dark mode on true black: every dark rule (generated or hand-written) is repeated under
// [data-tone="black"], with the navy surfaces, borders and greyish-blue texts turned neutral. Accents, status
// colors and charts keep their hue, so everything validated for the dark mode still reads the same way.
const darkToken = '[data-theme="dark"]'
function blackColor(hex) {
  const [hue, saturation, light] = hsl(bytes(hex))
  const alpha = hex.length === 9 ? hex.slice(7) : hex.length === 5 ? hex[4].repeat(2) : ''
  const cool = hue >= 180 && hue <= 250
  let result
  if (light >= .5) result = cool && saturation < .55 ? chromatic(hue, Math.min(saturation, .05), light) : hex.slice(0, 7)
  else if (saturation < .15 || (cool && (saturation < .5 || light < .22))) result = chromatic(hue, .03, light * .6)
  else result = light < .3 ? chromatic(hue, saturation, light * .8) : hex.slice(0, 7)
  return result + alpha
}
const blackValue = (value) => value.replace(/#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b/gi, (hex) => blackColor(hex.length < 6 ? `#${[...hex.slice(1, 4)].map((letter) => letter + letter).join('')}${hex.length === 5 ? hex[4].repeat(2) : ''}` : hex))
  .replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/g, (_, r, g, b, alpha) => blackColor(`#${[r, g, b].map((value) => Number(value).toString(16).padStart(2, '0')).join('')}`) + (alpha == null ? '' : Math.round(Number(alpha) * 255).toString(16).padStart(2, '0')))
const black = postcss.root()
black.append(postcss.comment({ text: 'Generated from every dark mode rule. Run npm run theme:build after changing the dark palette.' }))
const handWritten = await Promise.all([...files, 'theme.css'].map(async (file) => postcss.parse(await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8'))))
for (const source of [output, ...handWritten]) {
  source.walkRules((rule) => {
    if (rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
    const selectors = rule.selectors.filter((selector) => selector.includes(darkToken) && !selector.includes('data-tone'))
    if (!selectors.length) return
    const declarations = rule.nodes.filter((node) => node.type === 'decl' && (allowed.test(node.prop) || node.prop.startsWith('--'))).map((node) => ({ node, value: blackValue(node.value) })).filter(({ node, value }) => node.value !== value)
    if (!declarations.length) return
    const scoped = postcss.rule({ selector: selectors.map((selector) => selector.replace(darkToken, `${darkToken}[data-tone="black"]`)).join(', ') })
    for (const { node, value } of declarations) scoped.append({ prop: node.prop, value, important: node.important })
    let child = scoped
    for (let ancestor = rule.parent; ancestor.type !== 'root'; ancestor = ancestor.parent) {
      if (ancestor.type !== 'atrule') continue
      const wrapper = postcss.atRule({ name: ancestor.name, params: ancestor.params })
      wrapper.append(child); child = wrapper
    }
    black.append(child)
  })
}
await writeFile(new URL('../src/blackTheme.generated.css', import.meta.url), `${black.toString()}\n`, 'utf8')
console.log('Black ("escuro intenso") palette generated from the dark mode rules.')

// Fixed pixel sizes need explicit overrides; inherited sizes keep their existing ratios.
const typography = postcss.root()
typography.append(postcss.comment({ text: 'Generated from the existing typography. Default font sizes are untouched. Run npm run theme:build after CSS changes.' }))
typography.append(postcss.parse(':root[data-font-size="small"] { --account-font-scale: .9; }\n:root[data-font-size="large"] { --account-font-scale: 1.15; }\n:root:is([data-font-size="small"], [data-font-size="large"]) { font-size: calc(16px * var(--account-font-scale)); }'))
const fontScope = ':root:is([data-font-size="small"], [data-font-size="large"])'
for (const file of [...files, 'theme.css']) {
  const source = postcss.parse(await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8'))
  source.walkRules((rule) => {
    if (rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
    const declarations = []
    for (const node of rule.nodes) {
      if (node.type !== 'decl') continue
      if (node.prop === 'font-size' || node.prop === 'line-height') {
        if (/^[\d.]+px$/.test(node.value)) declarations.push({ prop: node.prop, value: `calc(${node.value} * var(--account-font-scale))`, important: node.important })
        else if (node.prop === 'font-size') declarations.push(node.clone())
      } else if (node.prop === 'font') {
        const size = postcss.list.space(node.value).find((value) => /^[\d.]+px$/.test(value))
        if (size || node.value === 'inherit') declarations.push({ prop: 'font-size', value: size ? `calc(${size} * var(--account-font-scale))` : 'inherit', important: node.important })
        else throw new Error(`Unsupported font shorthand in ${file}: ${node.value}`)
      }
    }
    if (!declarations.length) return
    const scoped = postcss.rule({ selector: rule.selectors.map((selector) => /^(:root|html)(?=\s|[.#:[>+~]|$)/.test(selector) ? selector.replace(/^(:root|html)/, fontScope) : `${fontScope} ${selector}`).join(', ') })
    for (const declaration of declarations) scoped.append(declaration)
    let child = scoped
    for (let ancestor = rule.parent; ancestor.type !== 'root'; ancestor = ancestor.parent) {
      if (ancestor.type !== 'atrule') continue
      const wrapper = postcss.atRule({ name: ancestor.name, params: ancestor.params })
      wrapper.append(child); child = wrapper
    }
    typography.append(child)
  })
}
// Safari zooms focused fields below 16px; the compact option must not trigger that zoom.
typography.append(postcss.parse('@media (max-width: 760px) { :root[data-font-size="small"] :is(input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), select, textarea) { font-size: 16px !important; } }'))
await writeFile(new URL('../src/fontSize.generated.css', import.meta.url), `${typography.toString()}\n`, 'utf8')
console.log('Small and large font overrides generated; default typography preserved.')
