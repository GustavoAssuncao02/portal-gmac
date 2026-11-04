// Desenhos do mapa da fábrica, em SVG. Cada equipamento é montado com caixas em perspectiva e recebe uma paleta: em cores
// quando alguém trabalha nele, em preto e branco quando está parado. O cenário e o equipamento ficam fixos; só os quadros
// do funcionário se alternam (FRAME_COUNT desenhos diferentes, um de cada vez, mostrados pelo CSS em factoryMap.css).
export const FRAME_COUNT = 6

const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)))
const shade = (hex, amount) => {
  const number = parseInt(hex.slice(1), 16)
  const channel = (shift) => clamp(((number >> shift) & 255) + 255 * amount)
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`
}
const colors = {
  blue: { body: '#1f5aa8', dark: '#22354d', accent: '#f2b705', metal: '#b9c3cf', light: '#eef2f6', glass: '#7fc4ee', floor: '#f2b705' },
  green: { body: '#4f8a45', dark: '#2c3b2c', accent: '#f2b705', metal: '#b9c3cf', light: '#eef2f6', glass: '#7fc4ee', floor: '#f2b705' },
}
const gray = { body: '#8c9095', dark: '#54575b', accent: '#bdbfc2', metal: '#b5b7ba', light: '#dcdddf', glass: '#a9acb0', floor: '#d3d5d8' }
export const paletteFor = (working, tone = 'blue') => working ? colors[tone] || colors.blue : gray

// Caixa em perspectiva: frente (x, y do canto inferior esquerdo), topo e lado direito, com profundidade `d`.
function Box({ x, y, w, h, d = 14, fill }) {
  const dx = d * 0.55, dy = d * 0.5
  return <g>
    <polygon points={`${x},${y - h} ${x + w},${y - h} ${x + w + dx},${y - h - dy} ${x + dx},${y - h - dy}`} fill={shade(fill, 0.14)} />
    <polygon points={`${x + w},${y} ${x + w + dx},${y - dy} ${x + w + dx},${y - h - dy} ${x + w},${y - h}`} fill={shade(fill, -0.13)} />
    <rect x={x} y={y - h} width={w} height={h} fill={fill} />
  </g>
}
const Wheel = ({ x, y, r = 6, color }) => <g><circle cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth={2.2} /><path d={`M${x - r} ${y}H${x + r}M${x} ${y - r}V${y + r}`} stroke={color} strokeWidth={1.2} /></g>

const art = {
  // Barramento, cabeçote, placa e contraponto.
  lathe: (p) => <g>
    <Box x={-66} y={0} w={14} h={22} fill={p.dark} /><Box x={44} y={0} w={14} h={22} fill={p.dark} />
    <Box x={-72} y={-20} w={138} h={12} d={22} fill={p.body} />
    <Box x={-72} y={-32} w={40} h={34} d={22} fill={p.body} />
    <circle cx={-27} cy={-46} r={11} fill={p.metal} stroke={p.dark} strokeWidth={2} />
    <rect x={-22} y={-49} width={62} height={5} fill={p.light} stroke={p.dark} strokeWidth={0.8} />
    <Box x={38} y={-32} w={22} h={20} d={16} fill={p.metal} />
    <Box x={-6} y={-32} w={24} h={8} d={18} fill={p.dark} />
    <Wheel x={-52} y={-48} color={p.accent} /><Wheel x={6} y={-24} r={5} color={p.accent} />
  </g>,
  planer: (p) => <g>
    <Box x={-44} y={0} w={88} h={46} d={24} fill={p.body} />
    <Box x={-54} y={-46} w={108} h={14} d={30} fill={p.dark} />
    <rect x={-54} y={-14} width={108} height={7} fill={p.accent} />
    <Wheel x={40} y={-26} color={p.accent} />
  </g>,
  saw: (p) => <g>
    <Box x={-44} y={0} w={88} h={24} d={20} fill={p.body} />
    <Box x={-48} y={-24} w={96} h={6} d={24} fill={p.dark} />
  </g>,
  cnc: (p) => <g>
    <Box x={-70} y={0} w={126} h={72} d={30} fill={p.light} />
    <rect x={-70} y={-16} width={126} height={16} fill={p.body} />
    <rect x={-56} y={-60} width={66} height={36} fill={p.glass} stroke={p.dark} strokeWidth={2} />
    <circle cx={-34} cy={-42} r={9} fill={p.metal} stroke={p.dark} strokeWidth={1.4} />
    <Box x={56} y={-14} w={18} h={56} d={6} fill={p.dark} />
    <rect x={59} y={-66} width={12} height={12} fill={p.glass} /><path d="M60-49h10M60-44h10M60-39h10" stroke={p.accent} strokeWidth={2} />
  </g>,
  center: (p) => <g>
    <Box x={-74} y={0} w={132} h={92} d={36} fill={p.light} />
    <rect x={-74} y={-18} width={132} height={18} fill={p.body} />
    <rect x={-60} y={-80} width={48} height={58} fill={p.glass} stroke={p.dark} strokeWidth={2} /><rect x={-8} y={-80} width={48} height={58} fill={p.glass} stroke={p.dark} strokeWidth={2} />
    <Box x={-34} y={-92} w={46} h={20} d={22} fill={p.dark} />
    <Box x={58} y={-20} w={18} h={62} d={6} fill={p.dark} />
    <rect x={61} y={-78} width={12} height={14} fill={p.glass} /><path d="M62-59h10M62-54h10M62-49h10" stroke={p.accent} strokeWidth={2} />
  </g>,
  // Coluna, mesa em cruz, cabeçote e volantes.
  mill: (p) => <g>
    <Box x={-26} y={0} w={52} h={10} d={30} fill={p.dark} />
    <Box x={-17} y={-10} w={34} h={70} d={22} fill={p.body} />
    <Box x={-48} y={-36} w={96} h={8} d={24} fill={p.metal} />
    <Box x={-20} y={-80} w={40} h={22} d={26} fill={p.body} />
    <rect x={-5} y={-58} width={10} height={14} fill={p.dark} />
    <Wheel x={-52} y={-34} color={p.accent} /><Wheel x={52} y={-34} color={p.accent} /><Wheel x={0} y={-20} r={5} color={p.accent} />
  </g>,
  bench: (p) => <g>
    <Box x={-60} y={0} w={8} h={34} d={10} fill={p.body} /><Box x={50} y={0} w={8} h={34} d={10} fill={p.body} />
    <rect x={-54} y={-14} width={106} height={4} fill={p.body} />
    <Box x={-68} y={-34} w={134} h={7} d={30} fill={p.dark} />
    <Box x={-12} y={-41} w={26} h={7} d={12} fill={p.metal} />
  </g>,
  drill: (p) => <g>
    <Box x={-22} y={0} w={44} h={7} d={22} fill={p.dark} />
    <rect x={-5} y={-92} width={10} height={86} fill={p.metal} stroke={p.dark} strokeWidth={0.7} />
    <Box x={-16} y={-36} w={32} h={5} d={16} fill={p.body} />
    <Box x={-20} y={-92} w={40} h={22} d={20} fill={p.body} />
  </g>,
  cutoff: (p) => <g>
    <Box x={-40} y={0} w={80} h={14} d={22} fill={p.dark} />
    <Box x={-40} y={-14} w={40} h={6} d={20} fill={p.metal} />
  </g>,
  bender: (p) => <g>
    <Box x={-20} y={0} w={40} h={46} d={18} fill={p.body} />
    <circle cx={0} cy={-58} r={13} fill={p.metal} stroke={p.dark} strokeWidth={2} /><circle cx={-20} cy={-44} r={8} fill={p.metal} stroke={p.dark} strokeWidth={1.4} />
    
  </g>,
  brake: (p) => <g>
    <Box x={-64} y={0} w={16} h={62} d={22} fill={p.body} /><Box x={48} y={0} w={16} h={62} d={22} fill={p.body} />
    <Box x={-54} y={-4} w={108} h={14} d={18} fill={p.body} /><rect x={-54} y={-18} width={108} height={4} fill={p.accent} />
  </g>,
  // Mesa grande, pórtico e painel.
  torch: (p) => <g>
    <Box x={-82} y={0} w={150} h={26} d={46} fill={p.dark} />
    <polygon points="-74,-30 62,-30 80,-48 -56,-48" fill={p.metal} />
    <path d="M-56-37H70M-40-42H74M-66-33H62" stroke={p.dark} strokeWidth={0.8} />
    <Box x={-76} y={-26} w={12} h={38} d={8} fill={p.accent} /><Box x={58} y={-26} w={12} h={38} d={8} fill={p.accent} />
    <Box x={-70} y={-62} w={136} h={9} d={8} fill={p.accent} />
    <Box x={72} y={0} w={13} h={56} d={6} fill={p.dark} /><rect x={74} y={-52} width={9} height={11} fill={p.glass} />
  </g>,
  furnace: (p) => <g>
    <Box x={-44} y={0} w={88} h={66} d={30} fill={p.body} />
    <rect x={-30} y={-54} width={60} height={42} fill={p.dark} /><rect x={-22} y={-46} width={44} height={22} fill={p.accent} />
    <rect x={-12} y={-20} width={24} height={4} fill={p.metal} />
  </g>,
  press: (p) => <g>
    <Box x={-44} y={0} w={13} h={84} d={18} fill={p.body} /><Box x={31} y={0} w={13} h={84} d={18} fill={p.body} />
    <Box x={-46} y={-84} w={92} h={13} d={18} fill={p.body} />
    <Box x={-34} y={-22} w={68} h={8} d={18} fill={p.dark} /><rect x={-44} y={-10} width={88} height={8} fill={p.accent} />
    <Box x={-10} y={-102} w={20} h={18} d={10} fill={p.metal} />
  </g>,
  grinder: (p) => <g>
    <rect x={-6} y={-46} width={12} height={46} fill={p.dark} /><Box x={-20} y={0} w={40} h={6} d={18} fill={p.dark} />
    <Box x={-18} y={-46} w={36} h={18} d={14} fill={p.body} />
    <circle cx={-26} cy={-54} r={12} fill={p.metal} stroke={p.dark} strokeWidth={2} /><circle cx={26} cy={-54} r={12} fill={p.metal} stroke={p.dark} strokeWidth={2} />
  </g>,
  // Posto de pintura: a grade no piso e a peça no cavalete.
  booth: (p) => <g>
    <polygon points="-62,0 62,0 62,-8 -62,-8" fill={p.dark} />
    <path d="M-52-4H52M-44-8V0M-22-8V0M0-8V0M22-8V0M44-8V0" stroke={p.metal} strokeWidth={1} />
    <Box x={-12} y={-8} w={5} h={30} d={4} fill={p.dark} /><Box x={8} y={-8} w={5} h={30} d={4} fill={p.dark} />
    <Box x={-20} y={-38} w={40} h={4} d={12} fill={p.dark} />
    <circle cx={1} cy={-50} r={12} fill={p.body} stroke={p.dark} strokeWidth={1.4} strokeDasharray="4 2.4" /><circle cx={1} cy={-50} r={4} fill={p.light} />
  </g>,
}
export const MachineArt = ({ type, palette }) => (art[type] || art.bench)(palette)

// ---------- Funcionário ----------
const uniform = { shirt: '#1b3f7a', stripe: '#f28c1e', pants: '#17263c', skin: '#c98d62', hair: '#2b211c', boot: '#101820', glove: '#d9dee4' }
// Cotovelo entre o ombro e a mão, dobrando para fora.
function elbow(sx, sy, hx, hy, side) {
  const mx = (sx + hx) / 2, my = (sy + hy) / 2, dx = hx - sx, dy = hy - sy, length = Math.hypot(dx, dy) || 1
  const reach = Math.max(0, 19 - length / 2) * 0.9
  return [mx + side * (-dy / length) * reach, my + side * (dx / length) * reach]
}
function Arm({ sx, sy, hx, hy, side }) {
  const [ex, ey] = elbow(sx, sy, hx, hy, side)
  return <g><polyline points={`${sx},${sy} ${ex},${ey}`} fill="none" stroke={uniform.shirt} strokeWidth={6.4} strokeLinecap="round" /><polyline points={`${ex},${ey} ${hx},${hy}`} fill="none" stroke={uniform.skin} strokeWidth={5} strokeLinecap="round" /><circle cx={hx} cy={hy} r={3.2} fill={uniform.glove} /></g>
}
const Spark = ({ x, y, seed }) => <g stroke="#ffb020" strokeWidth={1.4}>{[0, 1, 2, 3, 4].map((index) => { const angle = seed + index * 1.25, size = 5 + (index + seed) % 5; return <line key={index} x1={x} y1={y} x2={x + Math.cos(angle) * size} y2={y + Math.sin(angle) * size} /> })}<circle cx={x} cy={y} r={2.2} fill="#fff4c2" stroke="none" /></g>

const frameKeys = Array.from({ length: FRAME_COUNT }, (_, index) => index)

// ---------- O trabalho em cada máquina ----------
// Tudo nas coordenadas da máquina: onde o funcionário pisa e onde estão as mãos em cada quadro, sempre sobre um comando ou
// sobre a peça. O corpo não sai do lugar; só as mãos e as partes da máquina andam, e cada quadro é um desenho diferente.
const around = (x, y, r, frame) => { const angle = frame * Math.PI / 3 - Math.PI / 2; return [x + Math.cos(angle) * r, y + Math.sin(angle) * r] }
const spokes = (x, y, r, frame, color) => { const angle = frame * Math.PI / 3; const dx = Math.cos(angle) * r, dy = Math.sin(angle) * r; return <path d={`M${x - dx} ${y - dy}L${x + dx} ${y + dy}M${x + dy} ${y - dx}L${x - dy} ${y + dx}`} stroke={color} strokeWidth={1.8} /> }
const chips = (x, y, frame) => <g fill="#e8b84a">{[0, 1, 2].map((index) => { const step = (frame + index * 2) % 6; return <circle key={index} cx={x + step * 2.2 - index} cy={y - step * 1.6 + step * step * 0.32} r={1.3} /> })}</g>
const sweep = [0, 1, 2, 3, 2, 1]
export const workScripts = {
  // Torno: em pé ao lado do carro, a mão esquerda gira o volante e a direita firma a alavanca; a placa gira e o bedame corre pela peça.
  lathe: { foot: [26, 20], hands: (f) => { const [x, y] = around(6, -24, 5, f); return [x, y, 40, -29] }, part: (p, f, on) => <g>
    {spokes(-27, -46, 9, on ? f : 0, p.dark)}
    <rect x={2 + (on ? sweep[f] * 3 : 0)} y={-43} width={4} height={8} fill={p.dark} />
    {on && chips(5 + sweep[f] * 3, -45, f)}
    {spokes(6, -24, 5, on ? f : 0, p.accent)}
  </g> },
  // Plaina: o cabeçote vai e volta sobre a peça; a mão direita avança a mesa pelo volante.
  planer: { foot: [26, 20], hands: (f) => { const [x, y] = around(40, -26, 5, f); return [14, -30, x, y] }, part: (p, f, on) => { const shift = on ? (sweep[f] - 1.5) * 9 : 0; return <g>
    <Box x={-14 + shift} y={-60} w={28} h={24} d={20} fill={p.metal} />
    <rect x={-3 + shift} y={-50} width={6} height={10} fill={p.dark} />
    <rect x={-16} y={-54} width={32} height={6} fill={p.light} stroke={p.dark} strokeWidth={0.6} />
    {on && chips(shift + 3, -52, f)}
    {spokes(40, -26, 6, on ? f : 0, p.accent)}
  </g> } },
  // Serra: o arco desce devagar e corta; as mãos seguram a barra sobre a mesa.
  saw: { foot: [-22, 20], hands: () => [-32, -29, -14, -29], part: (p, f, on) => { const down = on ? sweep[f] * 1.1 : 0; return <g>
    <rect x={-48} y={-31} width={62} height={5} fill={p.light} stroke={p.dark} strokeWidth={0.7} />
    <g transform={`rotate(${down} -40 -30)`}><polygon points="-40,-34 32,-62 40,-52 -32,-24" fill={p.accent} stroke={p.dark} strokeWidth={1.4} /><rect x={-22} y={-40} width={44} height={8} fill={p.metal} transform="rotate(-21 0 -36)" /></g>
    {on && chips(8, -30, f)}
  </g> } },
  // Torno CNC: a direita digita no painel, a esquerda apoia na máquina; dentro da janela, a placa gira e a ferramenta corta.
  cnc: { foot: [46, 6], hands: (f) => [30, -18, 62 + [0, 6, 3, 8, 0, 4][f], -46 + [0, 0, 4, 4, 8, 8][f]], part: (p, f, on) => <g>
    {spokes(-34, -42, 8, on ? f : 0, p.dark)}
    <rect x={-25} y={-44} width={26} height={4} fill={p.light} stroke={p.dark} strokeWidth={0.5} />
    <rect x={-22 + (on ? sweep[f] * 4 : 0)} y={-38} width={4} height={8} fill={p.dark} />
    {on && chips(-20 + sweep[f] * 4, -41, f)}
    <rect x={59} y={-66} width={12} height={12} fill={p.glass} />
    {on && <rect x={60} y={-65 + (f % 3) * 3} width={10} height={2} fill="#fff" />}
  </g> },
  // Centro de usinagem: painel na mão direita; dentro das portas, o cabeçote desce e passa sobre a peça.
  center: { foot: [48, 2], hands: (f) => [34, -18, 64 + [0, 6, 3, 8, 0, 4][f], -58 + [0, 0, 4, 4, 8, 8][f]], part: (p, f, on) => { const x = on ? -30 + sweep[f] * 15 : -14; return <g>
    <rect x={-52} y={-34} width={84} height={8} fill={p.metal} /><rect x={-26} y={-40} width={36} height={6} fill={p.light} stroke={p.dark} strokeWidth={0.5} />
    <rect x={x} y={-74} width={14} height={24} fill={p.dark} /><rect x={x + 5} y={-50} width={4} height={10} fill={p.metal} stroke={p.dark} strokeWidth={0.5} />
    {on && chips(x + 7, -41, f)}
    <rect x={61} y={-78} width={12} height={14} fill={p.glass} />
    {on && <rect x={62} y={-77 + (f % 3) * 4} width={10} height={2} fill="#fff" />}
  </g> } },
  // Fresadora: a esquerda gira o volante da mesa, a direita o volante da frente; a fresa gira e a peça corre sob ela.
  mill: { foot: [-22, 14], hands: (f) => { const [x, y] = around(-52, -34, 6, f); const [u, v] = around(0, -20, 4, 5 - f); return [x, y, u, v] }, part: (p, f, on) => { const shift = on ? (sweep[f] - 1.5) * 4 : 0; return <g>
    {spokes(0, -46, 5, on ? f : 0, p.metal)}
    <rect x={-14 + shift} y={-43} width={28} height={6} fill={p.light} stroke={p.dark} strokeWidth={0.6} />
    {on && chips(2, -44, f)}
    {spokes(-52, -34, 6, on ? f : 0, p.accent)}{spokes(52, -34, 6, on ? f : 0, p.accent)}{spokes(0, -20, 5, on ? 5 - f : 0, p.accent)}
  </g> } },
  // Bancada: as duas mãos na lima, que vai e volta sobre a peça presa na morsa.
  bench: { foot: [-30, 8], hands: (f) => { const x = (sweep[f] - 1.5) * 7; return [x - 12, -40, x + 18, -42] }, part: (p, f, on) => { const x = on ? (sweep[f] - 1.5) * 7 : 0; return on ? <g>
    <rect x={x - 12} y={-43} width={30} height={3} fill="#4a525c" /><rect x={-7} y={-46} width={16} height={5} fill={p.light} stroke={p.dark} strokeWidth={0.5} />
    {sweep[f] % 2 === 1 && chips(x + 10, -44, f)}
  </g> : null } },
  // ---------- Caldeiraria ----------
  // Bancada: a esquerda firma a chapa na morsa, a direita desce o martelo sobre ela; no quadro da batida, a fagulha.
  hammer: { foot: [-30, 8], hands: (f) => [-14, -42, 8, -44 - [14, 9, 3, 0, 5, 11][f]], part: (p) => <rect x={-10} y={-45} width={24} height={4} fill={p.light} stroke={p.dark} strokeWidth={0.5} />, over: (p, f) => { const y = -44 - [14, 9, 3, 0, 5, 11][f]; return <g><rect x={7} y={y - 14} width={2.6} height={16} fill="#7a5230" /><rect x={2} y={y - 19} width={13} height={6} fill="#3a4654" />{f === 3 && <Spark x={8} y={-46} seed={1.2} />}</g> } },
  // Bancada de trás (a planta a opera pelo outro lado): as duas mãos na lima, sobre a peça.
  benchBack: { behind: true, foot: [2, -24], hands: (f) => { const x = (sweep[f] - 1.5) * 7; return [x - 14, -42, x + 14, -44] }, part: (p, f, on) => { const x = on ? (sweep[f] - 1.5) * 7 : 0; return on ? <g><rect x={-7} y={-46} width={16} height={5} fill={p.light} stroke={p.dark} strokeWidth={0.5} /><rect x={x - 14} y={-45} width={28} height={3} fill="#4a525c" />{sweep[f] % 2 === 1 && chips(x + 6, -45, f)}</g> : null } },
  // Solda: máscara abaixada; a esquerda segura a peça, a direita corre a tocha pela emenda, com o arco aceso.
  weld: { foot: [-30, 8], shield: true, hands: (f) => [-14, -42, 2 + sweep[f] * 4, -50], part: (p) => <rect x={-10} y={-45} width={32} height={4} fill={p.light} stroke={p.dark} strokeWidth={0.5} />, over: (p, f) => { const x = 2 + sweep[f] * 4; return <g><path d={`M${x} -50L${x + 3} -44`} stroke="#39424e" strokeWidth={3} /><circle cx={x + 3} cy={-44} r={4 + (f % 2) * 2} fill="#fff4c2" opacity={0.8} /><Spark x={x + 3} y={-44} seed={f * 1.7} /></g> } },
  // Furadeira: a mão no braço desce o mandril, a outra firma a peça na mesa.
  drill: { foot: [46, 8], hands: (f) => [33 + sweep[f] * 0.7, -68 + sweep[f] * 3, 20, -40], part: (p, f, on) => { const down = on ? sweep[f] * 3 : 0; return <g>
    <rect x={-2} y={-70} width={4} height={13 + down} fill={p.dark} /><path d={`M18 -74L33 ${-68 + down}`} stroke={p.accent} strokeWidth={3} />
    <rect x={-10} y={-44} width={22} height={4} fill={p.light} stroke={p.dark} strokeWidth={0.5} />{on && down > 5 && chips(0, -46, f)}
  </g> } },
  // Poli corte: a mão puxa o cabo e o disco desce sobre a barra; quando encosta, sai fagulha.
  cutoff: { foot: [50, 8], hands: (f) => [30 - sweep[f], -56 + sweep[f] * 4.2, 26, -14], part: (p, f, on) => { const down = on ? sweep[f] * 3.4 : 0; return <g>
    <rect x={-44} y={-22} width={62} height={5} fill={p.light} stroke={p.dark} strokeWidth={0.6} />
    <g transform={`rotate(${-down} -30 -12)`}><path d="M-30 -12L-4 -46" stroke={p.body} strokeWidth={6} /><circle cx={-4} cy={-46} r={24} fill={p.accent} stroke={p.dark} strokeWidth={2} />{spokes(-4, -46, 20, on ? f : 0, p.dark)}<circle cx={-4} cy={-46} r={5} fill={p.dark} /><path d="M-4 -46L30 -56" stroke={p.body} strokeWidth={4} /></g>
    {on && down > 5 && <Spark x={-6} y={-22} seed={f * 2.1} />}
  </g> } },
  // Viradoura: as duas mãos empurram o tubo para dentro dos rolos, que giram.
  bender: { foot: [-68, 8], hands: (f) => [-52 + sweep[f] * 3, -40, -36 + sweep[f] * 3, -40], part: (p, f, on) => { const shift = on ? sweep[f] * 3 : 0; return <g>
    <path d={`M${-60 + shift} -40H-10`} stroke={p.dark} strokeWidth={4} /><path d="M-10 -40Q0 -40 8 -30" fill="none" stroke={p.dark} strokeWidth={4} />
    {spokes(0, -58, 10, on ? f : 0, p.dark)}{spokes(-20, -44, 6, on ? 5 - f : 0, p.dark)}
  </g> } },
  // Dobradeira: as mãos seguram a chapa, a lâmina desce e a ponta da chapa sobe com a dobra.
  brake: { foot: [-84, 8], hands: (f) => [-66, -24 - sweep[f] * 2.4, -52, -22 - sweep[f] * 1.8], part: (p, f, on) => { const down = on ? sweep[f] * 2.4 : 0, fold = on ? sweep[f] * 3.5 : 0; return <g>
    <Box x={-54} y={-48 + down} w={108} h={18} d={18} fill={p.dark} /><polygon points={`-48,${-30 + down} 48,${-30 + down} 44,${-22 + down} -44,${-22 + down}`} fill={p.metal} />
    <g transform={`rotate(${fold} -30 -19)`}><rect x={-74} y={-21} width={84} height={3} fill={p.light} stroke={p.dark} strokeWidth={0.5} /></g>
  </g> } },
  // Mesa de corte a maçarico: por trás da mesa, as mãos conduzem o carro pelo pórtico; a chama corta a chapa.
  torch: { behind: true, foot: [0, -44], hands: (f) => { const x = -6 + (sweep[f] - 1.5) * 12; return [x - 8, -64, x + 12, -64] }, part: (p, f, on) => { const x = -6 + (on ? (sweep[f] - 1.5) * 12 : 0); return <g>
    {on && <path d={`M-40 -38H${x + 2}`} stroke="#3a4654" strokeWidth={1.2} />}
    <Box x={x - 6} y={-54} w={14} h={18} d={6} fill={p.body} />
    {on && <g><path d={`M${x + 1} -36l-2 5h4z`} fill="#7fc4ee" /><Spark x={x + 1} y={-32} seed={f * 1.3} /></g>}
  </g> } },
  // Prensa: pelo vão da prensa, as mãos firmam a peça e o cilindro desce o prato sobre ela.
  press: { behind: true, foot: [-15, -14], hands: () => [-16, -28, 16, -28], part: (p, f, on) => { const down = on ? sweep[f] * 3.4 : 0; return <g>
    <rect x={-5} y={-72} width={10} height={26 + down} fill={p.metal} /><Box x={-16} y={-46 + down} w={32} h={7} d={12} fill={p.dark} />
    <rect x={-12} y={-30} width={24} height={8} fill={p.light} stroke={p.dark} strokeWidth={0.5} />
  </g> } },
  // ---------- Demais atividades ----------
  // Têmpera: com a tenaz, as duas mãos levam a peça para dentro do forno, com o fogo aceso.
  quench: { foot: [-62, 10], hands: (f) => { const x = sweep[f] * 2; return [-52 + x, -36, -40 + x, -36] }, part: (p, f, on) => on ? <rect x={-22} y={-46} width={44} height={22} fill="#ff8a1e" opacity={0.55 + (f % 3) * 0.2} /> : null, over: (p, f) => { const x = sweep[f] * 2; return <g><path d={`M${-52 + x} -36H${-12 + x}`} stroke="#39424e" strokeWidth={2.4} /><rect x={-12 + x} y={-39} width={13} height={6} fill="#ffd27a" stroke="#c8551a" strokeWidth={0.7} /></g> } },
  // Lixadeira: as duas mãos encostam a peça no disco, que gira e solta fagulha no ponto de contato.
  grinder: { foot: [-46, 10], hands: (f) => { const x = sweep[f] * 0.5; return [-44 + x, -45, -33 + x, -45] }, part: (p, f, on) => <g>{spokes(-26, -54, 10, on ? f : 0, p.dark)}{spokes(26, -54, 10, on ? f : 0, p.dark)}</g>, over: (p, f) => { const x = sweep[f] * 0.5; return <g><rect x={-46 + x} y={-47} width={15} height={4} fill={p.light} stroke={p.dark} strokeWidth={0.5} /><Spark x={-31 + x} y={-44} seed={f * 1.9} /></g> } },
  // ---------- Pintura ----------
  // Pintura: de máscara, a mão direita passa a pistola em volta da peça e a tinta vai cobrindo; a esquerda segura a mangueira.
  spray: { foot: [-38, -4], cap: '#e4e8ec', mask: true, hands: (f) => { const y = -60 + sweep[f] * 7; return [-50, -32, -22, y] }, part: (p, f, on) => on ? <path d={`M1 -62A12 12 0 ${f > 2 ? 1 : 0} 1 ${1 + 12 * Math.sin((f + 1) * Math.PI / 3)} ${-50 - 12 * Math.cos((f + 1) * Math.PI / 3)}`} fill="none" stroke="#f28c1e" strokeWidth={4} /> : null, over: (p, f) => { const y = -60 + sweep[f] * 7; return <g><path d={`M-50 -32Q-52 -10 -40 -8`} fill="none" stroke="#39424e" strokeWidth={1.6} /><rect x={-24} y={y - 4} width={13} height={4.5} fill="#39424e" /><rect x={-21} y={y} width={3} height={7} fill="#2f6fb0" /><polygon points={`-11,${y - 2} 12,${-62 + f} 12,${-38 - f}`} fill="#f28c1e" opacity={0.3} />{[0, 1, 2, 3].map((index) => <circle key={index} cx={-6 + ((index * 5 + f * 3) % 18)} cy={y - 2 + ((index * 7 + f * 5) % 13) - 6} r={1} fill="#f28c1e" opacity={0.7} />)}</g> } },
}
export const MachinePart = ({ script, palette }) => workScripts[script].part(palette, 0, false)

// Corpo parado, de costas para quem olha: só a posição das mãos muda de um quadro para outro. O corpo e os braços são
// desenhados à parte: quem opera por trás da máquina fica atrás dela, com os braços por cima.
function Body({ cap, mask, shield }) {
  return <g>
    <ellipse cx={0} cy={3} rx={18} ry={5} fill="#000" opacity={0.16} />
    <path d="M-5 -24L-7 0M5 -24L7 0" stroke={uniform.pants} strokeWidth={7.5} strokeLinecap="round" />
    <path d="M-11 2h8M3 2h8" stroke={uniform.boot} strokeWidth={4.4} strokeLinecap="round" />
    <path d="M-9 -22L-11 -50Q0 -54 11 -50L9 -22Z" fill={uniform.shirt} />
    <path d="M-9 -30H9" stroke={uniform.stripe} strokeWidth={2.4} />
    <text x={0} y={-37} textAnchor="middle" className="factory-worker-mark">GMAC</text>
    <circle cx={0} cy={-60} r={8.2} fill={uniform.skin} />
    <path d="M-8.2 -61a8.2 8.2 0 0 1 16.4 0z" fill={cap || uniform.hair} />
    {mask && <rect x={-5} y={-59} width={10} height={5} rx={2} fill="#4b8a5a" />}
    {shield && <rect x={-9} y={-68} width={18} height={15} rx={4} fill="#2b3440" />}
  </g>
}
const Arms = ({ lx, ly, rx, ry }) => <g><Arm sx={-10} sy={-47} hx={lx} hy={ly} side={-1} /><Arm sx={10} sy={-47} hx={rx} hy={ry} side={1} /></g>

// Os quadros de um posto: cada quadro traz a máquina trabalhando e as mãos nos comandos dela. `layer`: "back" só o corpo
// (atrás da máquina), "front" a máquina e os braços; sem ele, tudo junto, na frente.
export function Worker({ script, palette, layer, delay = 0 }) {
  const work = workScripts[script], [fx, fy] = work.foot, at = `translate(${fx} ${fy})`
  return <g className="factory-worker" style={{ '--factory-delay': `${delay}ms` }}>{frameKeys.map((frame) => {
    const [lx, ly, rx, ry] = work.hands(frame)
    return <g key={frame} className="factory-frame" data-frame={frame} style={{ '--factory-index': frame }}>
      {layer !== 'back' && work.part(palette, frame, true)}
      {layer !== 'front' && <g transform={at}><Body cap={work.cap} mask={work.mask} shield={work.shield} /></g>}
      {layer !== 'back' && <g transform={at}><Arms lx={lx - fx} ly={ly - fy} rx={rx - fx} ry={ry - fy} /></g>}
      {layer !== 'back' && work.over?.(palette, frame)}
    </g>
  })}</g>
}
