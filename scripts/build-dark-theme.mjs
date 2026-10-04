import { readFile, writeFile } from 'node:fs/promises'
import postcss from 'postcss'

const files = ['operator.css', 'employeeActivity.css', 'orderEditing.css', 'orderDetails.css', 'adminHome.css', 'notifications.css', 'adminTools.css', 'payables.css', 'machineHistory.css', 'styles.css', 'mobile.css']
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
