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

// Estoque Administrativo: groups of supplies, as the office organizes them ("Material de expediente", "Material de
// limpeza", "Copa e cozinha"... — user's choice of 2026-11-14). Also used by its filter.
export const adminMaterialIcons = [
  { key: 'office', label: 'Material de expediente', icon: 'PenLine' },
  { key: 'cleaning', label: 'Material de limpeza', icon: 'SprayCan' },
  { key: 'kitchen', label: 'Copa e cozinha', icon: 'Coffee' },
  { key: 'hygiene', label: 'Higiene pessoal', icon: 'SoapDispenserDroplet' },
  { key: 'disposable', label: 'Descartáveis', icon: 'CupSoda' },
  { key: 'computer', label: 'Suprimentos de informática', icon: 'Keyboard' },
  { key: 'electrical', label: 'Material elétrico', icon: 'Lightbulb' },
  { key: 'safety', label: 'EPI e uniformes', icon: 'HardHat' },
  { key: 'first-aid', label: 'Primeiros socorros', icon: 'BriefcaseMedical' },
  { key: 'packaging', label: 'Embalagens', icon: 'Package' },
  { key: 'maintenance', label: 'Manutenção predial', icon: 'Hammer' },
  { key: 'other', label: 'Outros', icon: 'Archive' },
]

export const defaultAdminMaterialIcon = 'office'
// The icon of a material in the given set (a missing or foreign key falls back to the set's first icon).
export const iconIn = (icons, key) => icons.find((item) => item.key === key) || icons[0]
