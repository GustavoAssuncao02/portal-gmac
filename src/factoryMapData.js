// Mapa da fábrica no Planejamento: só leitura. Liga os postos da planta da GMAC às máquinas cadastradas (pelo nome) e às
// sessões de trabalho em andamento das OS; nada aqui grava, reserva ou bloqueia.
export const plain = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

// Os postos exatamente como na planta da GMAC: posição (x, y da base do equipamento, nas coordenadas da planta), nome e o
// lado de onde se opera (a seta da planta): bottom, top, left ou right. `names`: como cada um pode estar no cadastro.
// `scale`: tamanho do desenho, para o setor caber entre as colunas.
// As bancadas com `service` não são máquinas: são os postos de quem está em um serviço de hora homem.
const CALDEIRARIA_SCALE = 0.85
export const machinePosts = [
  // Setor Usinagem
  { key: 'torno-1', script: 'lathe', label: 'Torno 01 Convencional', sector: 'Usinagem', art: 'lathe', x: 115, y: 280, side: 'bottom', names: ['torno convencional 1', 'torno convencional 01', 'torno 01 convencional', 'torno 1'] },
  { key: 'torno-2', script: 'lathe', label: 'Torno Convencional 02', sector: 'Usinagem', art: 'lathe', x: 315, y: 340, side: 'bottom', names: ['torno convencional 2', 'torno convencional 02', 'torno 02 convencional', 'torno 2'] },
  { key: 'plaina', script: 'planer', label: 'Plaina', sector: 'Usinagem', art: 'planer', x: 520, y: 255, side: 'bottom', names: ['plaina limadora', 'plaina'] },
  { key: 'serra', script: 'saw', label: 'Serra', sector: 'Usinagem', art: 'saw', x: 615, y: 437, side: 'bottom', names: ['serra'] },
  { key: 'torno-cnc', script: 'cnc', label: 'Torno CNC', sector: 'Usinagem', art: 'cnc', x: 160, y: 540, side: 'bottom', names: ['torno cnc'] },
  { key: 'ferramenteira', script: 'mill', label: 'Fresadora Ferramenteira', sector: 'Usinagem', art: 'mill', x: 375, y: 632, side: 'bottom', names: ['fresadora convencional', 'fresadora ferramenteira'] },
  { key: 'universal', script: 'mill', label: 'Fresadora Universal', sector: 'Usinagem', art: 'mill', tone: 'green', x: 600, y: 632, side: 'bottom', names: ['fresadora universal'] },
  { key: 'centro', script: 'center', label: 'Centro de Usinagem', sector: 'Usinagem', art: 'center', x: 155, y: 885, side: 'bottom', names: ['centro de usinagem'] },
  { key: 'bancada-usinagem', script: 'bench', label: 'Bancada', sector: 'Usinagem', art: 'bench', x: 430, y: 825, side: 'bottom', names: ['bancada', 'bancada usinagem'] },
  // Setor Caldeiraria
  { key: 'bancada-1', script: 'hammer', label: 'Bancada', sector: 'Caldeiraria', art: 'bench', x: 830, y: 150, scale: CALDEIRARIA_SCALE, side: 'bottom', service: true, names: [] },
  { key: 'bancada-2', script: 'hammer', label: 'Bancada', sector: 'Caldeiraria', art: 'bench', x: 1005, y: 150, scale: CALDEIRARIA_SCALE, side: 'bottom', service: true, names: [] },
  { key: 'solda', script: 'weld', label: 'Bancada Solda', sector: 'Caldeiraria', art: 'bench', x: 1180, y: 150, scale: CALDEIRARIA_SCALE, side: 'bottom', names: ['solda', 'bancada solda', 'bancada de solda'] },
  { key: 'furadeira', script: 'drill', label: 'Furadeira de Coluna', sector: 'Caldeiraria', art: 'drill', x: 785, y: 310, scale: CALDEIRARIA_SCALE, side: 'right', names: ['furadeira', 'furadeira de coluna'] },
  { key: 'policorte', script: 'cutoff', label: 'Poli Corte', sector: 'Caldeiraria', art: 'cutoff', x: 790, y: 450, scale: CALDEIRARIA_SCALE, side: 'right', names: ['policorte', 'poli corte'] },
  { key: 'bancada-3', script: 'benchBack', label: 'Bancada', sector: 'Caldeiraria', art: 'bench', x: 1000, y: 430, scale: CALDEIRARIA_SCALE, side: 'top', service: true, names: [] },
  { key: 'viradora', script: 'bender', label: 'Viradoura Tubo', sector: 'Caldeiraria', art: 'bender', x: 1225, y: 330, scale: CALDEIRARIA_SCALE, side: 'left', names: ['viradora de tubos', 'viradoura tubo', 'viradoura de tubo'] },
  { key: 'dobradeira', script: 'brake', label: 'Dobradeira', sector: 'Caldeiraria', art: 'brake', x: 1205, y: 590, scale: CALDEIRARIA_SCALE, side: 'left', names: ['dobradeira'] },
  { key: 'macarico', script: 'torch', label: 'Mesa Corte Maçarico', sector: 'Caldeiraria', art: 'torch', x: 880, y: 740, scale: CALDEIRARIA_SCALE, side: 'top', names: ['macarico', 'mesa corte macarico', 'mesa de corte a macarico'] },
  // Demais atividades, na parte de baixo do Setor Pintura.
  { key: 'lixadeira', script: 'grinder', label: 'Lixadeira', sector: 'Demais atividades', art: 'grinder', x: 1410, y: 700, side: 'bottom', names: ['lixadeira'] },
  { key: 'tempera', script: 'quench', label: 'Têmpera', sector: 'Demais atividades', art: 'furnace', x: 1590, y: 700, side: 'bottom', names: ['tempera'] },
  { key: 'servico-5', script: 'hammer', label: 'Bancada', sector: 'Demais atividades', art: 'bench', x: 1410, y: 900, side: 'bottom', service: true, names: [] },
  { key: 'servico-6', script: 'hammer', label: 'Bancada', sector: 'Demais atividades', art: 'bench', x: 1590, y: 900, side: 'bottom', service: true, names: [] },
  { key: 'prensa', script: 'press', label: 'Prensa Hidráulica', sector: 'Caldeiraria', art: 'press', x: 1160, y: 860, scale: CALDEIRARIA_SCALE, side: 'top', names: ['prensa', 'prensa hidraulica'] },
]
// Os postos de pintura, preenchidos por ordem de chegada, pois o sistema não registra em qual deles a pessoa está.
export const paintBooths = [[1410, 230], [1590, 230], [1410, 450], [1590, 450]].map(([x, y], index) => ({ key: `pintura-${index + 1}`, label: `Pintura ${index + 1}`, sector: 'Pintura', art: 'booth', script: 'spray', x, y, side: 'inside' }))

// Quando a pessoa começou neste recurso: a mesma origem da tela de Máquinas, somada à troca de máquina ou serviço na sessão.
export const sessionStart = (session) => Date.parse(session.resourceStartedAt || session.machineStartedAt || session.startedAt)

// `orders`: GET /operations/orders; `machines`: GET /machines. Cada posto recebe `work` (a sessão em andamento) ou nada.
// Quem está em algo que não existe na planta não tem posto: fica em `outside`, para o mapa dizer que há gente fora dele.
export function factoryStations(orders = [], machines = []) {
  const sessions = orders.flatMap((order) => (order.operation?.activeSessions || []).map((session) => ({ ...session, orderCode: order.code, orderService: order.service }))).sort((a, b) => (sessionStart(a) || 0) - (sessionStart(b) || 0))
  const byId = new Map(machines.map((machine) => [String(machine.id), machine]))
  const posts = machinePosts.map((post) => {
    const machine = machines.find((item) => post.names.includes(plain(item.name))) || null
    return { ...post, machine, machineName: machine?.name || post.label, registered: Boolean(machine) || Boolean(post.service), maintenance: machine?.maintenance || null, work: [] }
  })
  const paint = [], services = [], outside = []
  for (const session of sessions) {
    const post = session.machineId != null && posts.find((item) => item.machine && String(item.machine.id) === String(session.machineId))
    if (post) post.work.push(session)
    else if (session.machineId == null && plain(session.laborServiceName).includes('pintura')) paint.push(session)
    else if (session.machineId == null && session.laborServiceName) services.push(session)
    else outside.push({ ...session, resourceName: (session.machineId != null ? byId.get(String(session.machineId))?.name ?? session.machineName : session.laborServiceName) || 'Sem máquina ou serviço informado' })
  }
  // As bancadas de serviço e os postos de pintura se preenchem por ordem de chegada; quem passar do número de postos é informado.
  const benches = posts.filter((post) => post.service)
  benches.forEach((bench, index) => { if (services[index]) { bench.work.push(services[index]); bench.machineName = services[index].laborServiceName } })
  outside.push(...[...services.slice(benches.length), ...paint.slice(paintBooths.length)].map((session) => ({ ...session, resourceName: session.laborServiceName })))
  const booths = paintBooths.map((place, index) => ({ ...place, machineName: paint[index]?.laborServiceName || place.label, registered: true, work: paint[index] ? [paint[index]] : [] }))
  return { stations: [...posts, ...booths], outside, working: sessions.length }
}

export function elapsedLabel(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000)), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60)
  return `${hours ? `${hours} h ` : ''}${String(minutes).padStart(hours ? 2 : 1, '0')} min ${String(seconds % 60).padStart(2, '0')} s`
}
