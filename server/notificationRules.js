export const notificationOptions = [
  ['materialRequests', 'Novos pedidos de material'],
  ['serviceCompleted', 'Serviços concluídos pelo operador'],
  ['lowStock', 'Estoque baixo de materiais'],
  ['serviceAdded', 'Novos serviços em andamento'],
  ['proposalSaved', 'Propostas salvas'],
  ['siteOffers', 'Ofertas recebidas pelo site'],
  ['openOffers', 'Ofertas em aberto para assumir'],
  ['supportTickets', 'Tickets de suporte'],
]
export const notificationDefaults = Object.fromEntries(notificationOptions.map(([key]) => [key, true]))
// Notices everybody gets whatever the preferences: a new version of the portal and an update scheduled, rescheduled,
// canceled or 5 minutes away (Desenvolvedor › Programar atualização).
export const alwaysShownNotices = new Set(['release', 'system-update'])
// "Notificações do sistema por e-mail" (2026-11-24): whether the account receives the e-mails the system sends by itself
// (today, those of the support tickets). On unless the person turns it off. Password recovery is not a notification and
// is always sent; e-mails someone writes (a proposal to a client) are not affected.
export const emailNotificationsLabel = 'Notificações do sistema por e-mail'
export const emailNotificationsOff = 'Notificações por e-mail desativadas nas configurações da conta.'
export const notificationPreference = { 'material-request': 'materialRequests', 'service-completed': 'serviceCompleted', 'low-stock': 'lowStock', 'service-added': 'serviceAdded', 'proposal-saved': 'proposalSaved', 'site-offer': 'siteOffers', 'open-offer': 'openOffers', 'ticket-opened': 'supportTickets', 'ticket-status': 'supportTickets', 'ticket-comment': 'supportTickets', 'note-invite': 'notesNotifications', 'note-answer': 'notesNotifications', 'note-change': 'notesNotifications', 'note-done': 'notesNotifications', 'note-removed': 'notesNotifications', 'note-reminder': 'notesNotifications', 'note-due': 'notesNotifications' }
// Anotações e Tarefas (Configurações): the round button in the corner of the screens, its notices (bell and e-mail) and
// the notice of a task near its day (how many days before). Kept with the notification preferences of the account.
export const notesPreferenceDefaults = { notesButton: true, notesNotifications: true, notesDueReminder: true, notesDueDays: 1 }
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
