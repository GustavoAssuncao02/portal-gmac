// Turns the mockups of the commemorative looks of the login (login-<name>.html, made outside the repository) into
// src/loginThemes: the markup of each look as strings, kept exactly as in its mockup without the comments, and its CSS
// with every rule limited to .login-page--<name>, so nothing applies outside the look. The animations written in
// JavaScript (src/loginThemes/effects.js) and the dates (src/loginThemes/calendar.js) are kept by hand.
// Usage: node scripts/build-login-themes.mjs <folder of the mockups>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

const dir = process.argv[2]
if (!dir) throw new Error('Informe a pasta dos modelos: node scripts/build-login-themes.mjs <pasta>')
const outDir = fileURLToPath(new URL('../src/loginThemes/', import.meta.url))
mkdirSync(outDir, { recursive: true })
const themes = ['carnaval', 'pascoa', 'sao-joao', 'independencia','dia-dos-pais', 'dia-das-maes', 'dia-da-mulher', 'prevencao-acidentes', 'dia-do-trabalhador']
const warnings = []

const read = (name) => readFileSync(path.join(dir, `login-${name}.html`), 'utf8').replace(/\r/g, '')
const slice = (text, start, end, from = 0) => {
  const a = text.indexOf(start, from)
  if (a < 0) throw new Error(`missing ${start}`)
  const b = text.indexOf(end, a + start.length)
  if (b < 0) throw new Error(`missing ${end}`)
  return { value: text.slice(a + start.length, b), end: b }
}
const clean = (html) => html.replace(/<!--[\s\S]*?-->/g, '').split('\n').map((line) => line.replace(/\s+$/, '')).filter((line) => line.trim()).join('\n').trim()
const literal = (text) => '`' + text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`'

function scope(css, prefix) {
  const root = postcss.parse(css)
  root.walkRules((rule) => {
    if (rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
    rule.selectors = rule.selectors.map((raw) => {
      let selector = raw.trim()
      if (selector === '.fx-on #fx-page') return `${prefix} .fx-page--on`
      selector = selector.replace(/#fx-page\b/g, '.fx-page').replace(/\.fx-on\b/g, '.season-on')
      if (selector.startsWith(':root')) return selector.replace(':root', prefix)
      return `${prefix} ${selector}`
    })
    // The card keeps its own overflow: the stripe on top of it is clipped by a frame that follows the card corners.
    if (rule.selector.endsWith('.access-panel .login-card')) rule.walkDecls('overflow', (decl) => decl.remove())
  })
  return root.toString()
}

// Base shared by the themes (the mockups carry the same copy).
const first = read(themes[0])
const baseCss = first.slice(first.indexOf('*/', first.indexOf('PARTE 2 — BASE')) + 2, first.indexOf('/* =====', first.indexOf('PARTE 2 — BASE') + 20)).trim()
for (const name of themes.slice(1)) {
  const html = read(name)
  const other = html.slice(html.indexOf('*/', html.indexOf('PARTE 2 — BASE')) + 2, html.indexOf('/* =====', html.indexOf('PARTE 2 — BASE') + 20)).trim()
  if (other !== baseCss) warnings.push(`${name}: base CSS differs from ${themes[0]}`)
}
writeFileSync(path.join(outDir, 'fx.css'), `/* Base shared by the commemorative looks of the login (generated from the mockups' "base dos temas" by scripts/build-login-themes.mjs).
   Every rule hangs on .login-page--fx, present only while one of those looks is on. */
${scope(baseCss, '.login-page--fx')}
.login-page--fx .fx-layers { display: contents; }
.login-page--fx .fx-card-frame { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; pointer-events: none; }
`)

const index = []
for (const name of themes) {
  const html = read(name)
  const css = html.slice(html.indexOf('*/', html.indexOf('PARTE 3')) + 2, html.indexOf('</style>')).trim()
  const title = html.slice(html.indexOf('PARTE 3 — TEMA:') + 'PARTE 3 — TEMA:'.length, html.indexOf('(prefixo', html.indexOf('PARTE 3'))).trim()
  const body = html.slice(html.indexOf('<body>'))
  const logo = slice(body, '<svg class="brand-panel__logo brand-logo"', '</svg>\n      </div>\n      <span class="brand-panel__rule"').value
  const defs = slice(logo, '<defs>', '</defs>').value
  const themeDefs = clean(defs.replace(/<mask[\s\S]*?<\/mask>/, ''))
  const behind = clean(slice(logo, '</defs>', '<image').value)
  const front = clean(logo.slice(logo.indexOf('nome-metalurgica.png" width="1329" height="1018"/>') + 'nome-metalurgica.png" width="1329" height="1018"/>'.length))
  const panelBack = clean(slice(body, '<div class="brand-panel__veil"></div>', '<div class="brand-panel__content brand-intro"').value)
  const subtitleEnd = body.indexOf('orçamentos.</p>')
  const contentEnd = body.indexOf('\n    </div>\n', subtitleEnd)
  const badgeBlock = body.slice(subtitleEnd, contentEnd)
  const badge = slice(badgeBlock, '<div class="fx-badge">', '</div>').value
  const panelFront = clean(body.slice(contentEnd + '\n    </div>\n'.length, body.indexOf('</section>', contentEnd)))
  const card = slice(body, '<div class="login-card">', '<div class="login-card__heading">').value.trim()
  const cardMarkup = card === '<span class="fx-card-bar" aria-hidden="true"></span>' ? null : clean(card)
  const pageCanvas = body.includes('<canvas id="fx-page"')
  // CSS animations on an element that also has a transform attribute would drop that position (the mockup bug of the New Year tassel).
  const animated = [...css.matchAll(/\.([a-z]+-[a-z0-9-]+)\{[^}]*animation:/g)].map((match) => match[1])
  for (const cls of animated) {
    const regex = new RegExp(`<[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*\\stransform="`, 'g')
    if (regex.test(body)) warnings.push(`${name}: .${cls} has a transform attribute and a CSS animation`)
  }
  writeFileSync(path.join(outDir, `${name}.css`), `/* ${title}: look of the login generated from its mockup by scripts/build-login-themes.mjs. Every rule hangs on .login-page--${name}. */\n${scope(css, `.login-page--${name}`)}\n`)
  writeFileSync(path.join(outDir, `${name}.js`), `// ${title}: markup of the look, kept exactly as in its mockup (generated by scripts/build-login-themes.mjs). When it shows: calendar.js.
import './${name}.css'

export default {
  id: '${name}',
  logoBehind: ${literal([themeDefs && `<defs>${themeDefs}</defs>`, behind].filter(Boolean).join('\n'))},
  logoFront: ${literal(front)},
  panelBack: ${literal(panelBack)},
  panelFront: ${literal(panelFront)},
  badge: ${literal(badge)},
  card: ${cardMarkup ? literal(cardMarkup) : 'null'},
  pageCanvas: ${pageCanvas},
}
`)
  index.push({ name, title, sizes: { themeDefs: themeDefs.length, behind: behind.length, front: front.length, panelBack: panelBack.length, panelFront: panelFront.length, badge: badge.length, card: cardMarkup?.length || 0 }, pageCanvas })
}

// Birthday screen (after the login).
{
  const html = read('aniversario')
  const css = html.slice(html.indexOf('*/', html.indexOf('PARTE 3')) + 2, html.indexOf('</style>')).trim()
  const root = postcss.parse(css)
  root.walkRules((rule) => { rule.selectors = rule.selectors.map((s) => s.replace(/#bd-confetti\b/g, '.bd-confetti')) })
  writeFileSync(path.join(outDir, 'birthday.css'), `/* Birthday screen shown after the login (generated from its mockup by scripts/build-login-themes.mjs). Its classes all start with bd-. */\n${root.toString()}\n`)
  const body = html.slice(html.indexOf('<body>'))
  const balloons = slice(body, '<div class="bd-balloons" aria-hidden="true">', '</div>\n  <div class="bd-card">').value
  const cake = clean(slice(body, '<svg class="bd-cake" viewBox="0 0 140 130" aria-hidden="true">', '</svg>\n    <p class="bd-kicker">').value)
  const texts = {
    kicker: slice(body, '<p class="bd-kicker">', '</p>').value,
    message: slice(body, '<p class="bd-msg">', '</p>').value,
    button: slice(body, 'id="bd-continue">', '</button>').value,
  }
  writeFileSync(path.join(outDir, 'birthday.markup.js'), `// Drawings of the birthday screen, kept exactly as in its mockup (generated by scripts/build-login-themes.mjs).
export const balloons = ${literal(balloons)}
export const cake = ${literal(cake)}
export const texts = ${JSON.stringify(texts)}
`)
  index.push({ name: 'aniversario', balloons: balloons.length, cake: cake.length, texts })
}

console.log(JSON.stringify(index, null, 1))
console.log('warnings:', warnings)
