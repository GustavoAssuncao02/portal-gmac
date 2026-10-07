export const notificationOptions = [
  ['materialRequests', 'Novos pedidos de material'],
  ['serviceCompleted', 'Serviços concluídos pelo operador'],
  ['lowStock', 'Estoque baixo de materiais'],
  ['serviceAdded', 'Novos serviços em andamento'],
]
export const notificationDefaults = Object.fromEntries(notificationOptions.map(([key]) => [key, true]))
export const notificationPreference = { 'material-request': 'materialRequests', 'service-completed': 'serviceCompleted', 'low-stock': 'lowStock', 'service-added': 'serviceAdded' }
