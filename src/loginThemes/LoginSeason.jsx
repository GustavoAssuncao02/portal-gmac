import { ChristmasCardSnow, ChristmasFrost, ChristmasHat, ChristmasSky, ChristmasSnow, ChristmasSnowbank } from './Christmas.jsx'
import { NewYearAura, NewYearBadge, NewYearCardBar, NewYearConfetti, NewYearHat, NewYearSky } from './NewYear.jsx'
import { FxAura, FxBadge, FxCardDecor, FxLogoBehind, FxLogoFront, FxPageParticles, FxPanelBack, FxPanelFront, fxThemes } from './FxTheme.jsx'

// Commemorative looks of the login screen. calendar.js says which one is on today ("season": 'christmas', 'new-year',
// one of the fxThemes or null); these pieces put it on the screen. They only add decorations on top of the normal
// screen: nothing in them takes part in the login itself.
export { loginSeason } from './calendar.js'

export const seasonClassName = (season) => season ? ` login-page--${season}${fxThemes[season] ? ' login-page--fx' : ''}` : ''

// Behind the login card, on the white side.
export function SeasonBackdrop({ season }) {
  if (season === 'christmas') return <ChristmasFrost />
  if (season === 'new-year') return <NewYearAura />
  return fxThemes[season] ? <FxAura /> : null
}

// On the edge of the login card.
export function SeasonCardDecor({ season }) {
  if (season === 'christmas') return <ChristmasCardSnow />
  if (season === 'new-year') return <NewYearCardBar />
  return fxThemes[season] ? <FxCardDecor theme={fxThemes[season]} /> : null
}

// Inside the logo, behind the symbol.
export function SeasonLogoBehind({ season }) {
  return fxThemes[season] ? <FxLogoBehind theme={fxThemes[season]} /> : null
}

// Inside the logo, in front of it (hats, ribbons, flags...).
export function SeasonLogoFront({ season }) {
  if (season === 'christmas') return <ChristmasHat />
  if (season === 'new-year') return <NewYearHat />
  return fxThemes[season] ? <FxLogoFront theme={fxThemes[season]} /> : null
}

// Blue panel, behind the logo and the texts.
export function SeasonPanelBack({ season, introDone }) {
  if (season === 'christmas') return <ChristmasSky />
  if (season === 'new-year') return <NewYearSky visible={introDone} />
  return fxThemes[season] ? <FxPanelBack theme={fxThemes[season]} introDone={introDone} /> : null
}

// Blue panel, in front of the texts (snowbank, grass, flags...).
export function SeasonPanelFront({ season }) {
  if (season === 'christmas') return <ChristmasSnowbank />
  return fxThemes[season] ? <FxPanelFront theme={fxThemes[season]} /> : null
}

// Badge under the subtitle.
export function SeasonBadge({ season }) {
  if (season === 'new-year') return <NewYearBadge />
  return fxThemes[season] ? <FxBadge theme={fxThemes[season]} /> : null
}

// Snow, confetti or particles over the whole screen, from the end of the logo intro.
export function SeasonPageEffect({ season, visible, panelRef }) {
  if (season === 'christmas') return <ChristmasSnow visible={visible} panelRef={panelRef} />
  if (season === 'new-year') return <NewYearConfetti visible={visible} panelRef={panelRef} />
  return fxThemes[season] ? <FxPageParticles theme={fxThemes[season]} visible={visible} panelRef={panelRef} /> : null
}
