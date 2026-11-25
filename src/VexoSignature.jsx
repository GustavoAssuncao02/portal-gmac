import './vexoSignature.css'

// "VEXO METAL" signature under the login card (the system's maker), drawn from the brand kit (VEXO_METAL_Kit/SVG). It
// enters after the GMAC logo, small and quiet: the two lines run towards the mark, the hexagon is drawn empty, the three
// bars rise and the dots come out of them while the name appears. On a commemorative day (loginThemes/calendar.js) the
// mark gets a small touch of its own after the entrance. Only decoration: it ignores the mouse and the touch.

// Wordmark paths of the kit (vexo_metal_horizontal.svg), placed on one line: "VEXO" then "METAL", as in the login mockup.
const V_PATH = 'M161.76 187.38 140.54 249H124.81L103.84 187.38H118.79L131.64 230.27Q132.67 233.75 132.89 236.41H133.15Q133.45 233.53 134.48 230.09L147.24 187.38Z'
const EXO_PATH = 'M208.11 249H171.15V187.38H206.69V198.68H185.03V212.39H205.19V223.65H185.03V237.74H208.11Z M270.31 249H253.85L243.24 228.93Q242.63 227.82 241.99 224.81H241.82Q241.52 226.23 240.4 229.11L229.74 249H213.2L232.84 218.19L214.88 187.38H231.76L240.57 205.86Q241.6 208.05 242.42 211.06H242.59Q243.11 209.25 244.53 205.69L254.32 187.38H269.79L251.31 217.93Z M305.69 250.07Q292.46 250.07 284.12 241.46Q275.79 232.84 275.79 219.01Q275.79 204.4 284.25 195.38Q292.72 186.35 306.68 186.35Q319.87 186.35 328.02 194.99Q336.16 203.62 336.16 217.76Q336.16 232.29 327.71 241.18Q319.27 250.07 305.69 250.07ZM306.29 198.3Q298.99 198.3 294.69 203.78Q290.4 209.25 290.4 218.28Q290.4 227.43 294.69 232.76Q298.99 238.09 305.95 238.09Q313.13 238.09 317.34 232.91Q321.55 227.73 321.55 218.54Q321.55 208.95 317.47 203.62Q313.38 198.3 306.29 198.3Z'
const METAL_PATH = 'M178.41 295H172.64V279.5Q172.64 276.99 172.86 273.95H172.72Q172.26 276.34 171.9 277.39L165.83 295H161.06L154.88 277.57Q154.63 276.86 154.07 273.95H153.91Q154.14 277.78 154.14 280.67V295H148.89V269.09H157.43L162.73 284.45Q163.36 286.29 163.65 288.15H163.76Q164.24 286 164.79 284.41L170.08 269.09H178.41Z M205.83 295H190.3V269.09H205.24V273.84H196.13V279.61H204.61V284.34H196.13V290.27H205.83Z M234.18 273.84H226.79V295H220.94V273.84H213.59V269.09H234.18Z M266.45 295H260.09L258.25 289.24H249.03L247.21 295H240.89L250.32 269.09H257.24ZM256.91 284.76 254.13 276.05Q253.82 275.07 253.7 273.72H253.55Q253.46 274.86 253.1 275.98L250.28 284.76Z M291.11 295H275.68V269.09H281.52V290.27H291.11Z'

const HALO = '0,-54 46.8,-27 46.8,27 0,54 -46.8,27 -46.8,-27'
const HEX = '0,-42 36.4,-21 36.4,21 0,42 -36.4,21 -36.4,-21'
const delay = (seconds) => ({ '--d': `${seconds}s` })

// Christmas: snow piles on the top of the hexagon, the lump at the right corner slides off and falls outside the mark,
// it piles again and falls again. The snow of each slope is drawn with the edge lying flat (y = 0 on the edge, x = 0 on
// the lower corner, x = 42 on the top; outwards is negative).
const SNOW = 'M -4 0.8 L 43.5 0.8 L 43.5 -10 C 40 -13.2 35.5 -11.6 31.5 -12.6 C 27 -13.8 22.5 -11.4 18 -12.4 C 13.5 -13.4 9 -11 5 -11.6 C 0.5 -12.2 -3.5 -9.6 -5.6 -5.6 C -6.8 -3.2 -6 -0.6 -4 0.8 Z'
const SNOW_TOP = 'M 15 0.8 L 43.5 0.8 L 43.5 -10 C 40 -13.2 35.5 -11.6 31.5 -12.6 C 27 -13.8 22.5 -11.4 18 -12.4 C 16 -12.8 14.2 -12 13.4 -9.8 C 12.6 -6.6 13 -2.4 15 0.8 Z'
const SNOW_LUMP = 'M -4 0.8 L 19 0.8 C 21.6 -2.4 22 -7.6 20.6 -10.6 C 19.4 -13 16.4 -13.2 13.5 -12.4 C 10.5 -11.6 8 -11.2 5 -11.6 C 0.5 -12.2 -3.5 -9.6 -5.6 -5.6 C -6.8 -3.2 -6 -0.6 -4 0.8 Z'
const slope = (d, className) => <g transform="translate(-36.4 -21) rotate(-30)"><path className={className} d={d} /></g>
const flakes = [[-30, -33.5, 0, 3.4], [-12, -46, 1.1, 2.9], [6, -50, 2.2, 3.2], [24, -40.5, 0.6, 3.6], [36, -33.5, 1.7, 3]]
// The lump breaks at the corner into these clumps: [x, y, radius, sideways drift, fall].
const crumbs = [[49, -24, 4.6, 5, 56], [55, -19, 3.4, 11, 62], [50, -15, 2.6, 1, 50]]
function ChristmasFront() {
  return <g className="vx-xm">
    <defs>
      <linearGradient id="vx-snow" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#dbe7f3" />
      </linearGradient>
    </defs>
    {flakes.map(([x, y, start, length]) => <circle key={x} className="vx-xm-flake" cx={x} cy={y} r="1.7" style={{ ...delay(start), '--t': `${length}s` }} />)}
    {slope(SNOW, 'vx-xm-snow vx-xm-snow--left')}
    <g transform="scale(-1 1)">{slope(SNOW_TOP, 'vx-xm-snow vx-xm-snow--right')}</g>
    <circle className="vx-xm-snow vx-xm-peak" cx="0" cy="-48" r="7" />
    <g transform="scale(-1 1)">{slope(SNOW_LUMP, 'vx-xm-snow vx-xm-snow--lump')}</g>
    <g className="vx-xm-chunk"><g transform="scale(-1 1)">{slope(SNOW_LUMP, 'vx-xm-snow')}</g></g>
    {crumbs.map(([x, y, radius, drift, fall]) => <circle key={x} className="vx-xm-crumb" cx={x} cy={y} r={radius} style={{ '--cx': `${drift}px`, '--cy': `${fall}px` }} />)}
  </g>
}

// New Year: small fireworks over the mark, the orange dots twinkle in gold.
const rays = Array.from({ length: 12 }, (_, index) => index * 30)
const rayColors = ['#f4a300', '#ff6a00', '#e8b44c']
const burst = (x, y, className) => <g transform={`translate(${x} ${y})`}><g className={`vx-ny-burst ${className}`}>
  {rays.map((angle, index) => {
    const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians)
    return <g key={angle}>
      <line x1={cos * 5} y1={sin * 5} x2={cos * 15} y2={sin * 15} stroke={rayColors[index % 3]} />
      <circle cx={cos * 19} cy={sin * 19} r="1.4" fill={rayColors[(index + 1) % 3]} />
    </g>
  })}
  <circle r="2.6" fill="#ffb703" />
</g></g>
function NewYearFront() {
  return <g className="vx-ny">{burst(-66, -34, 'vx-ny-burst--a')}{burst(58, -56, 'vx-ny-burst--b')}{burst(-14, -68, 'vx-ny-burst--c')}</g>
}

// Carnival: the bars dance like an equalizer and confetti falls around the mark.
const confetti = [[-54, '#ff4fa3', 0, 3.3, 10, 300], [-36, '#ffd23f', 1.2, 3.8, -8, -260], [-18, '#3ee6b0', 0.5, 3.1, 6, 340], [2, '#5ec8ff', 2, 3.6, -6, 280], [20, '#b07bff', 0.9, 3.4, 9, -320], [38, '#ff4fa3', 1.6, 3.9, -10, 250], [54, '#ffd23f', 0.2, 3.2, 7, -300]]
function CarnavalFront() {
  return <g className="vx-cv">{confetti.map(([x, color, start, length, sway, turn]) => <rect key={x} className="vx-cv-piece" x={x} y="-74" width="2.6" height="5" rx="0.7" fill={color} style={{ ...delay(start), '--t': `${length}s`, '--sx': `${sway}px`, '--r': `${turn}deg` }} />)}</g>
}

// Easter: bunny ears peek out from behind the hexagon now and then.
function EasterBehind() {
  const ear = (x, angle) => <g transform={`rotate(${angle} ${x} -44)`}>
    <ellipse className="vx-ps-ear" cx={x} cy="-60" rx="5.6" ry="14.5" />
    <ellipse className="vx-ps-inner" cx={x} cy="-58.5" rx="2.6" ry="9.5" />
  </g>
  return <g className="vx-ps-ears">{ear(-8, -14)}{ear(8, 14)}</g>
}

// Women's Day: a flower blooms on the corner of the hexagon and lets two petals fall.
const petals = [0, 72, 144, 216, 288]
function WomenFront() {
  const petal = (angle, index) => <ellipse key={angle} cx="0" cy="-5" rx="3.2" ry="5.4" fill={index % 2 ? '#ff7ab6' : '#c77dff'} transform={`rotate(${angle})`} />
  return <g className="vx-fl" transform="translate(40 -34) scale(1.45)">
    <g className="vx-fl-bloom">{petals.map(petal)}<circle r="2.7" fill="#ffd23f" /></g>
    <g className="vx-fl-petal vx-fl-petal--a"><ellipse cx="3" cy="-4" rx="2.6" ry="4.4" fill="#c77dff" /></g>
    <g className="vx-fl-petal vx-fl-petal--b"><ellipse cx="-3" cy="-2" rx="2.6" ry="4.4" fill="#ff7ab6" /></g>
  </g>
}

// Labor Day: sparks of metal being ground fly out of the lower corner of the hexagon.
const sparks = [[-34, 28, 0], [-42, 12, 0.06], [-22, 40, 0.12], [-48, 25, 0.04], [-30, 45, 0.16], [-40, 36, 0.09], [-16, 31, 0.2], [-50, 4, 0.14]]
const sparkColors = ['#ffb000', '#ff6a00', '#ffd23f']
function LaborFront() {
  return <g className="vx-wk" transform="translate(-33 25)">
    {sparks.map(([dx, dy, start], index) => <line key={index} className="vx-wk-spark" x1="0" y1="0" x2={dx * 0.3} y2={dy * 0.3} stroke={sparkColors[index % 3]} style={{ ...delay(start), '--dx': `${dx}px`, '--dy': `${dy}px` }} />)}
    <circle className="vx-wk-flash" r="4" fill="#ffd23f" />
  </g>
}

// Mother's Day: little hearts rise from behind the hexagon and the orange dots beat.
const HEART = 'M0 2.8 C -3.8 -0.4 -5.4 -2.6 -3.6 -4.7 C -2.2 -6.2 -0.6 -5.4 0 -4.1 C 0.6 -5.4 2.2 -6.2 3.6 -4.7 C 5.4 -2.6 3.8 -0.4 0 2.8 Z'
const hearts = [[-13, '#ff4d6d', 0, 4.4, 6], [3, '#ff8fab', 1.5, 4.8, -7], [17, '#ff4d6d', 3, 4.2, 5]]
function MothersBehind() {
  return <g className="vx-mh">{hearts.map(([x, color, start, length, sway]) => <g key={x} transform={`translate(${x} -27)`}><path className="vx-mh-heart" d={HEART} fill={color} style={{ ...delay(start), '--t': `${length}s`, '--sx': `${sway}px` }} /></g>)}</g>
}

// Accident prevention: a safety helmet drops on the hexagon and nods now and then (the lines become caution tape).
function PreventionFront() {
  return <g transform="translate(0 -44)"><g className="vx-pv-helmet">
    <path d="M -17 0 C -17 -14 -9 -20.5 0 -20.5 C 9 -20.5 17 -14 17 0 Z" fill="#ffd23f" stroke="#c99a00" strokeWidth="0.8" />
    <rect x="-2.6" y="-20" width="5.2" height="19" rx="1.6" fill="#ffe57f" />
    <rect x="-22" y="-2.4" width="44" height="4.6" rx="2.3" fill="#ffc61a" stroke="#c99a00" strokeWidth="0.8" />
    <path d="M -11.5 -12.8 V -6.8 M -14.5 -9.8 H -8.5" stroke="#1e9e5a" strokeWidth="2.2" strokeLinecap="round" />
  </g></g>
}

// Father's Day: a tie hangs from the hexagon and swings.
function FathersFront() {
  return <g transform="translate(0 41)"><g className="vx-dp-tie">
    <path d="M -4.2 0 H 4.2 L 3.2 5.2 H -3.2 Z" fill="#0d4380" />
    <path d="M -3.2 5.2 H 3.2 L 6.2 22 L 0 29 L -6.2 22 Z" fill="#0d4380" />
    <path d="M -4.4 11.5 L 4.6 8.4 M -5.4 18 L 5.6 14.8" stroke="#e8b44c" strokeWidth="1.7" />
  </g></g>
}

// Independence: the flag of Brazil goes up a pole on the top of the hexagon and waves.
function IndependenceFront() {
  return <g transform="translate(0 -42)">
    <line className="vx-in-pole" x1="0" y1="0" x2="0" y2="-35" stroke="#6b7c8f" strokeWidth="1.6" strokeLinecap="round" />
    <circle className="vx-in-pole" cx="0" cy="-36" r="1.7" fill="#ffdf00" />
    <g transform="translate(0.8 -34.5)"><g className="vx-in-raise"><g className="vx-in-wave">
      <rect width="23" height="15.5" fill="#009c3b" />
      <polygon points="11.5,1.8 21.2,7.75 11.5,13.7 1.8,7.75" fill="#ffdf00" />
      <circle cx="11.5" cy="7.75" r="3.7" fill="#002776" />
      <path d="M 8 7.2 Q 11.5 6 15 7.8" stroke="#ffffff" strokeWidth="0.7" fill="none" />
    </g></g></g>
  </g>
}

const seasonParts = {
  christmas: { front: ChristmasFront },
  'new-year': { front: NewYearFront },
  carnaval: { front: CarnavalFront },
  pascoa: { behind: EasterBehind },
  'dia-da-mulher': { front: WomenFront },
  'dia-do-trabalhador': { front: LaborFront },
  'dia-das-maes': { behind: MothersBehind },
  'prevencao-acidentes': { front: PreventionFront },
  'dia-dos-pais': { front: FathersFront },
  independencia: { front: IndependenceFront },
}

export default function VexoSignature({ season = null }) {
  const parts = seasonParts[season] || {}
  const Behind = parts.behind, Front = parts.front
  return <div className={`vexo-sign${season ? ` vexo-sign--${season}` : ''}`}>
    <span className="vexo-sign__line vexo-sign__line--left" aria-hidden="true" />
    <svg className="vexo-sign__mark" viewBox="0 0 666 108" role="img" aria-label="VEXO METAL">
      <g transform="translate(54 54)">
        {Behind && <g aria-hidden="true"><Behind /></g>}
        <polygon className="vx-halo" points={HALO} />
        <polygon className="vx-hex" points={HEX} pathLength="1" />
        {/* The dots come before the bars, so they start hidden inside them. */}
        <circle className="vx-dot vx-dot--l" cx="-13.5" cy="-22" r="5" />
        <circle className="vx-dot vx-dot--r" cx="13.5" cy="-22" r="5" />
        <circle className="vx-dot vx-dot--b" cx="0" cy="24" r="5" />
        <rect className="vx-bar vx-bar--l" x="-18" y="-16" width="9" height="26" rx="2" />
        <rect className="vx-bar vx-bar--r" x="9" y="-16" width="9" height="26" rx="2" />
        <rect className="vx-bar vx-bar--m" x="-4.5" y="0" width="9" height="18" rx="2" />
        {Front && <g aria-hidden="true"><Front /></g>}
      </g>
      <g className="vx-name">
        <g transform="translate(21.16 -164.21)"><path className="vx-v" d={V_PATH} /><path className="vx-ink" d={EXO_PATH} /></g>
      </g>
      <g className="vx-name vx-name--metal">
        <g transform="translate(393 54) scale(1.9) translate(-148.89 -282.05)"><path className="vx-ink" d={METAL_PATH} /></g>
      </g>
    </svg>
    <span className="vexo-sign__line vexo-sign__line--right" aria-hidden="true" />
  </div>
}
