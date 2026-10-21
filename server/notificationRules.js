export const notificationOptions = [
  ['materialRequests', 'Novos pedidos de material'],
  ['serviceCompleted', 'Serviços concluídos pelo operador'],
  ['lowStock', 'Estoque baixo de materiais'],
  ['serviceAdded', 'Novos serviços em andamento'],
]
export const notificationDefaults = Object.fromEntries(notificationOptions.map(([key]) => [key, true]))
export const notificationPreference = { 'material-request': 'materialRequests', 'service-completed': 'serviceCompleted', 'low-stock': 'lowStock', 'service-added': 'serviceAdded' }
// Sound played when a new notification arrives; each account picks one or turns them off ('off').
// The sounds themselves are synthesized in the browser (src/notificationSounds.js).
export const notificationSounds = [
  ['sino', 'Sino'],
  ['gota', 'Gota'],
  ['dois-tons', 'Dois tons'],
  ['acorde', 'Acorde'],
  ['bolha', 'Bolha'],
  ['xilofone', 'Xilofone'],
  ['metal', 'Toque metálico'],
  ['alerta', 'Alerta'],
  ['morgan', 'Morgan'],
  ['coleta', 'Coleta'],
]
export const notificationSoundDefault = 'sino'
export const validNotificationSound = (value) => value === 'off' || notificationSounds.some(([key]) => key === value)
