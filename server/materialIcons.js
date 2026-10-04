export const materialIcons = [
  { key: 'sheet', label: 'Chapas', icon: 'Layers' },
  { key: 'bar', label: 'Barras', icon: 'Minus' },
  { key: 'tube', label: 'Tubos', icon: 'Cylinder' },
  { key: 'profile', label: 'Perfis', icon: 'Columns3' },
  { key: 'coil', label: 'Bobinas', icon: 'Disc3' },
  { key: 'block', label: 'Blocos', icon: 'Box' },
  { key: 'gear', label: 'Engrenagens', icon: 'Cog' },
  { key: 'bolt', label: 'Parafusos', icon: 'Bolt' },
  { key: 'nut', label: 'Porcas', icon: 'Hexagon' },
  { key: 'chain', label: 'Correntes', icon: 'Link' },
  { key: 'welding', label: 'Soldagem', icon: 'Flame' },
  { key: 'paint', label: 'Tintas', icon: 'PaintBucket' },
  { key: 'abrasive', label: 'Abrasivos', icon: 'Disc' },
  { key: 'tool', label: 'Ferramentas', icon: 'Wrench' },
]

export const defaultMaterialIcon = 'sheet'
export const materialIcon = (key) => materialIcons.find((item) => item.key === key) || materialIcons[0]
