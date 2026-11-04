import { memo } from 'react'
import { machinePosts, paintBooths } from './factoryMapData.js'
import { MachineArt, MachinePart, paletteFor, workScripts } from './FactoryMapArt.jsx'

// O cenário do mapa da fábrica: piso de concreto, parede do fundo com as luminárias, colunas entre os setores e as sombras.
// Fica em uma camada própria, desenhada uma só vez, atrás dos postos: as animações não precisam redesenhar luz nem sombra.
export const WIDTH = 1740, HEIGHT = 1040
const LAMPS = [190, 520, 860, 1150, 1420, 1620]
// A divisão entre a pintura e as demais atividades, no mesmo galpão.
const DIVIDER_Y = 565
const SIGNS = [['SETOR USINAGEM', 360], ['SETOR CALDEIRARIA', 1003], ['SETOR PINTURA', 1514], ['DEMAIS ATIVIDADES', 1514, DIVIDER_Y - 18]]
// A área de cada setor: nenhuma sombra atravessa as paredes.
const SECTORS = [['Usinagem', 14, 683], ['Caldeiraria', 721, 573], ['Pintura', 1318, 408]]
const FLOOR_TOP = 78, FLOOR_HEIGHT = 948

// Largura de cada desenho e a marcação no piso, conforme o lado de operação na planta.
const artWidth = { lathe: 150, planer: 120, saw: 106, cnc: 160, center: 166, mill: 124, bench: 138, drill: 66, cutoff: 96, bender: 96, brake: 140, torch: 176, press: 110, grinder: 110, furnace: 130 }
export function floorMark({ art, side }) {
  const width = artWidth[art] || 146, x = -width / 2 - 8, full = width + 16
  if (side === 'bottom') return { x, y: -12, width: full, height: 44 }
  if (side === 'top') return { x, y: -44, width: full, height: 58 }
  if (side === 'right') return { x, y: -18, width: full + 66, height: 32 }
  return { x: x - 70, y: -18, width: full + 70, height: 32 }
}

const posts = [...machinePosts, ...paintBooths]
const palette = paletteFor(false)

function SectorShadows({ name }) {
  const inside = posts.filter((post) => post.sector === name || (post.sector === 'Demais atividades' && name === 'Pintura'))
  return <g clipPath={`url(#factory-sector-${name})`}>
    {inside.map((post) => <ellipse key={post.key} cx={post.x + 6} cy={post.y + 6} rx={(post.art === 'booth' ? 120 : floorMark(post).width) * 0.42 * (post.scale || 1)} ry={18} fill="#0a1423" opacity={0.42} filter="url(#factory-contact)" />)}
    <g filter="url(#factory-cast)">{inside.map((post) => <g key={post.key} transform={`translate(${post.x} ${post.y}) scale(${post.scale || 1})`}><MachineArt type={post.art} palette={palette} />{workScripts[post.script].part(palette, 0, false)}</g>)}</g>
  </g>
}

export default memo(function FactoryScene() {
  const pools = LAMPS.flatMap((x) => [260, 640].map((y) => <ellipse key={`${x}-${y}`} cx={x} cy={y} rx={260 + y * 0.12} ry={130 + y * 0.12} fill="url(#factory-pool)" />))
  return <svg className="factory-map-scene" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
    <defs>
      <radialGradient id="factory-pool"><stop offset="0" stopColor="#fff" stopOpacity=".36" /><stop offset=".55" stopColor="#fff" stopOpacity=".095" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
      <linearGradient id="factory-wall" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#979da4" /><stop offset=".72" stopColor="#c0c4c9" /><stop offset="1" stopColor="#adb1b7" /></linearGradient>
      <linearGradient id="factory-ground" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#a3a29e" /><stop offset=".3" stopColor="#bdbbb7" /><stop offset="1" stopColor="#d0cec9" /></linearGradient>
      <linearGradient id="factory-wall-shadow" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#0a1423" stopOpacity=".38" /><stop offset="1" stopColor="#0a1423" stopOpacity="0" /></linearGradient>
      <linearGradient id="factory-column-shadow" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#0a1423" stopOpacity=".32" /><stop offset="1" stopColor="#0a1423" stopOpacity="0" /></linearGradient>
      <linearGradient id="factory-column" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#8d9299" /><stop offset=".4" stopColor="#6c7178" /><stop offset="1" stopColor="#43474d" /></linearGradient>
      <filter id="factory-contact" x="-40%" y="-80%" width="180%" height="260%"><feGaussianBlur stdDeviation="9" /></filter>
      <filter id="factory-lamp" x="-60%" y="-200%" width="220%" height="500%"><feGaussianBlur stdDeviation="7" /></filter>
      <filter id="factory-cast" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur in="SourceAlpha" stdDeviation="5" /><feOffset dx="5" dy="9" /><feComponentTransfer><feFuncA type="linear" slope=".34" /></feComponentTransfer></filter>
      <filter id="factory-mottle" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".012 .018" numOctaves="3" seed="7" /><feColorMatrix values="0 0 0 0 .25  0 0 0 0 .24  0 0 0 0 .22  .8 .8 0 0 -.55" /></filter>
      <filter id="factory-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2" seed="3" /><feColorMatrix values="0 0 0 0 .2  0 0 0 0 .2  0 0 0 0 .19  .9 .9 0 0 -.72" /></filter>
      <clipPath id="factory-floor"><rect x={14} y={FLOOR_TOP} width={1712} height={FLOOR_HEIGHT} /></clipPath>
      {SECTORS.map(([name, x, width]) => <clipPath key={name} id={`factory-sector-${name}`}><rect x={x} y={FLOOR_TOP} width={width} height={FLOOR_HEIGHT} /></clipPath>)}
    </defs>
    {/* Piso: o concreto, as juntas de dilatação e as poças de luz das luminárias. */}
    <rect x={14} y={FLOOR_TOP} width={1712} height={FLOOR_HEIGHT} fill="url(#factory-ground)" />
    <g clipPath="url(#factory-floor)">
      <rect x={14} y={FLOOR_TOP} width={1712} height={FLOOR_HEIGHT} filter="url(#factory-mottle)" opacity={0.26} />
      <rect x={14} y={FLOOR_TOP} width={1712} height={FLOOR_HEIGHT} filter="url(#factory-grain)" opacity={0.3} />
      <path d="M14 340H1726M14 700H1726M360 78V1026M1003 78V1026M1514 78V1026" stroke="#5f5d59" strokeOpacity={0.28} strokeWidth={2} />
      {pools}
    </g>
    {/* Parede do fundo, com rodapé e a sombra dela no chão, e as luminárias. */}
    <rect x={14} y={14} width={1712} height={64} fill="url(#factory-wall)" />
    <rect x={14} y={72} width={1712} height={6} fill="#4d5259" />
    <rect x={14} y={FLOOR_TOP} width={1712} height={30} fill="url(#factory-wall-shadow)" />
    {LAMPS.map((x) => <g key={x}><rect x={x - 62} y={14} width={124} height={9} fill="#fff" filter="url(#factory-lamp)" /><rect x={x - 56} y={14} width={112} height={6} fill="#fffef4" /></g>)}
    {/* Colunas entre os setores (abertas embaixo, como na planta), com um lado iluminado e a sombra no piso. */}
    <rect x={721} y={FLOOR_TOP} width={56} height={810} fill="url(#factory-column-shadow)" /><rect x={1318} y={FLOOR_TOP} width={56} height={810} fill="url(#factory-column-shadow)" />
    <rect x={697} y={14} width={24} height={874} fill="url(#factory-column)" /><rect x={1294} y={14} width={24} height={874} fill="url(#factory-column)" />
    <polygon points="697,888 721,888 737,902 713,902" fill="#3a3e44" /><polygon points="1294,888 1318,888 1334,902 1310,902" fill="#3a3e44" />
    <path d={`M14 ${HEIGHT - 34}H${WIDTH - 14}`} stroke="#54585e" strokeWidth={4} />
    <rect x={14} y={14} width={WIDTH - 28} height={HEIGHT - 28} fill="none" stroke="#54585e" strokeWidth={7} />
    <path d={`M1318 ${DIVIDER_Y}H1726`} stroke="#54585e" strokeWidth={4} />
    {SIGNS.map(([name, x, y = 26]) => <g className="factory-sign" key={name}><rect x={x - 104} y={y} width={208} height={36} rx={5} /><text x={x} y={y + 24} textAnchor="middle">{name}</text></g>)}
    {SECTORS.map(([name]) => <SectorShadows key={name} name={name} />)}
  </svg>
})
