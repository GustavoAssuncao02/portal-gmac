import express from 'express'
import { randomUUID } from 'node:crypto'
import { readStore, mutateStore } from './offers.js'
import { addNotification } from './notificationEvents.js'
import { createMailer } from './passwordReset.js'
import { notificationSettings } from './accounts.js'
import {
  CHECKLIST_MAX, CHECKLIST_TEXT_MAX, COMMENT_MAX, PLACE_MAX, SHARE_MAX, TEXT_MAX, TITLE_MAX,
  addDays, bahiaDay, dateLabel, defaultReminder, dueLabel, dueMoment, dueNoticeTime, kindWord, labelOf, linkPattern, momentOf,
  nextOccurrence, noteColors, taskPriorities, taskReminders, taskRepeats, taskTypes, validDate, validTime,
} from './noteRules.js'

// Anotações e Tarefas (2026-11-24): the annotations and tasks of each person of the administrative portal
// (administrators and administrative employees; the operators' tablet has no access). Each one is personal or shared:
// whoever creates it invites other people, who accept or decline. Once accepted it is the same item for everybody:
// everyone edits it and sees the changes of the others; only whoever created it deletes it, the others may leave it.
// A shared task is concluded "só para mim" (the others see that this person did their part) or "para todos". Each
// person picks their own reminder of a task, and Configurações adds a notice some days before its day; both come in the
// bell and by e-mail, like the invitations.
// Everything lives in `store.noteItems`; `members` holds, for each person, the answer to the invitation, their reminder,
// their pin and whether they concluded the task, and `sent` the reminders already given (so each one is given once).
const HISTORY_MAX = 200
const COMMENTS_MAX = 500
// A reminder is still given if the server was off at its moment, while the task is not 12 hours past.
const LATE_REMINDER_MS = 12 * 3600000

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const same = (left, right) => String(left) === String(right)
const clean = (value, limit) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)
const multiline = (value, limit) => String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, limit)
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const init = (store) => { store.noteItems ||= [] }
const isTask = (item) => item.kind === 'task'
const memberOf = (item, userId) => item.members.find((member) => same(member.userId, userId))
const accepted = (item) => item.members.filter((member) => member.status === 'accepted')
const othersAccepted = (item, userId) => accepted(item).filter((member) => !same(member.userId, userId))
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || ''
const article = (item) => isTask(item) ? 'a tarefa' : 'a anotação'
const shortText = (value, limit = 120) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > limit ? `${text.slice(0, limit - 1)}…` : text }

// What one person receives of an item: the participants with their answers and whether they concluded, never the record
// of the reminders already given.
export function noteView(item, viewerId) {
  const { members, ...rest } = item
  const me = memberOf(item, viewerId)
  const done = isTask(item) && Boolean(item.completedAt || me?.doneAt)
  return {
    ...rest,
    own: same(item.ownerId, viewerId),
    shared: members.some((member) => !same(member.userId, item.ownerId) && member.status !== 'declined'),
    me: me ? { userId: me.userId, status: me.status, reminder: me.reminder || defaultReminder, pinned: Boolean(me.pinned), doneAt: me.doneAt || null } : null,
    done,
    participants: members.map(({ userId, userName, role, status, doneAt, invitedAt, respondedAt }) => ({ userId, userName, role, status, doneAt: doneAt || null, invitedAt: invitedAt || null, respondedAt: respondedAt || null })),
  }
}

// The content of an item as sent by the editor, checked. `current` keeps what the request does not send.
function readContent(body, kind, current = {}, store) {
  const pick = (key) => Object.hasOwn(body, key) ? body[key] : current[key]
  const title = clean(pick('title'), TITLE_MAX)
  const text = multiline(pick('text'), TEXT_MAX)
  const rawList = pick('checklist') ?? []
  if (!Array.isArray(rawList)) fail('Lista inválida.')
  const checklist = rawList.map((entry) => ({ id: typeof entry?.id === 'string' && entry.id.length <= 60 ? entry.id : randomUUID(), text: clean(entry?.text, CHECKLIST_TEXT_MAX), done: entry?.done === true })).filter((entry) => entry.text)
  if (checklist.length > CHECKLIST_MAX) fail(`A lista aceita até ${CHECKLIST_MAX} itens.`)
  const link = clean(pick('link'), 40).toUpperCase()
  if (link && !linkPattern.test(link)) fail('Vincule a uma OS (OS-2026-0001) ou oferta (OF-2026-0001).')
  if (link && store && !(link.startsWith('OS') ? store.orders : store.offers).some((row) => row.code === link)) fail(`${link.startsWith('OS') ? 'OS' : 'Oferta'} ${link} não encontrada.`)
  if (kind === 'note') {
    if (!title && !text && !checklist.length) fail('Escreva a anotação.')
    const color = pick('color')
    return { title, text, checklist, link, color: noteColors.some(([key]) => key === color) ? color : 'yellow' }
  }
  if (!title) fail('Dê um título à tarefa.')
  const dueDate = String(pick('dueDate') || '')
  const dueTime = String(pick('dueTime') || '')
  if (dueDate && !validDate(dueDate)) fail('Data inválida.')
  if (dueTime && !validTime(dueTime)) fail('Hora inválida.')
  if (dueTime && !dueDate) fail('Escolha a data da tarefa.')
  const taskType = taskTypes.some(([key]) => key === pick('taskType')) ? pick('taskType') : 'task'
  const priority = taskPriorities.some(([key]) => key === pick('priority')) ? pick('priority') : 'normal'
  const repeat = taskRepeats.some(([key]) => key === pick('repeat')) ? pick('repeat') : 'none'
  if (repeat !== 'none' && !dueDate) fail('Uma tarefa que se repete precisa de data.')
  return { title, text, checklist, link, dueDate, dueTime, taskType, place: taskType === 'meeting' ? clean(pick('place'), PLACE_MAX) : '', priority, repeat }
}

const readReminder = (value) => {
  if (value === undefined) return undefined
  if (!taskReminders.some(([key]) => key === value)) fail('Escolha um lembrete da lista.')
  return value
}

// The changes of an edit, in words, for the history and the notice of the others.
function changesOf(before, after) {
  const list = []
  if (before.title !== after.title) list.push(`mudou o título para "${after.title}"`)
  if (before.dueDate !== after.dueDate || before.dueTime !== after.dueTime) {
    const when = (item) => item.dueDate ? `${dateLabel(item.dueDate)}${item.dueTime ? ` ${item.dueTime}` : ''}` : 'sem data'
    list.push(`mudou a data de ${when(before)} para ${when(after)}`)
  }
  if (before.text !== after.text) list.push(isTask(before) ? 'alterou a descrição' : 'alterou o texto')
  if (JSON.stringify(before.checklist) !== JSON.stringify(after.checklist)) list.push(isTask(before) ? 'alterou os subitens' : 'alterou a lista')
  if (before.taskType !== after.taskType) list.push(`mudou o tipo para ${labelOf(taskTypes, after.taskType).toLowerCase()}`)
  if (before.place !== after.place && after.taskType === 'meeting') list.push(after.place ? `mudou o local para ${after.place}` : 'tirou o local')
  if (before.priority !== after.priority) list.push(`mudou a prioridade para ${labelOf(taskPriorities, after.priority).toLowerCase()}`)
  if (before.repeat !== after.repeat) list.push(after.repeat === 'none' ? 'tirou a repetição' : `passou a repetir: ${labelOf(taskRepeats, after.repeat).toLowerCase()}`)
  if (before.link !== after.link) list.push(after.link ? `vinculou a ${after.link}` : 'tirou o vínculo')
  if (before.color !== after.color && !isTask(before)) list.push('mudou a cor')
  return list
}

const historyEntry = (actor, text, at) => ({ id: randomUUID(), at, userId: actor.id, userName: actor.name, text })
function addHistory(item, actor, text, at) {
  item.history = [...(item.history || []), historyEntry(actor, text, at)].slice(-HISTORY_MAX)
}

// The e-mails of Anotações e Tarefas: an invitation, a reminder of a task and the notice of a task near its day.
const mailKinds = {
  invite: { label: 'Convite', color: '#0c4c91', background: '#e8f1fc' },
  reminder: { label: 'Lembrete', color: '#b45309', background: '#fff4e5' },
  due: { label: 'Prazo chegando', color: '#c5221f', background: '#fce8e6' },
}
export function noteMail({ kind, to, name, item, subject, preview, facts, message, closing }) {
  const type = mailKinds[kind]
  const text = [preview, '', `Olá, ${name}.`, '', `${type.label} · ${item.title || 'Anotação'}`, ...facts.map(([label, value]) => `${label}: ${value}`), ...(message ? ['', message] : []), '', closing].join('\n')
  const cell = 'font-family:Arial,Helvetica,sans-serif'
  const html = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6fa;padding:20px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe3ec;border-radius:10px">
<tr><td style="${cell};padding:18px 22px 6px"><span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${type.background};color:${type.color};font-size:12px;font-weight:bold;letter-spacing:.3px">${escapeHtml(type.label.toUpperCase())}</span></td></tr>
<tr><td style="${cell};padding:10px 22px 0;color:#33475b;font-size:14px">Olá, ${escapeHtml(name)}.</td></tr>
<tr><td style="${cell};padding:10px 22px 14px;color:#12345a;font-size:20px;font-weight:bold;line-height:1.3">${escapeHtml(item.title || 'Anotação')}</td></tr>
<tr><td style="padding:0 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e3e9f0">${facts.map(([label, value]) => `<tr><td style="${cell};padding:7px 12px 7px 0;color:#5b6f86;font-size:13px;width:130px;vertical-align:top">${escapeHtml(label)}</td><td style="${cell};padding:7px 0;color:#1d2f44;font-size:13px;font-weight:bold">${escapeHtml(value)}</td></tr>`).join('')}</table></td></tr>
${message ? `<tr><td style="padding:12px 22px 4px"><div style="${cell};white-space:pre-wrap;padding:12px 14px;border-left:4px solid ${type.color};background:#f6f9fc;color:#1d2f44;font-size:14px;line-height:1.5">${escapeHtml(message)}</div></td></tr>` : ''}
<tr><td style="${cell};padding:14px 22px 20px;color:#5b6f86;font-size:12px">${escapeHtml(closing)}</td></tr>
</table></td></tr></table>`
  return { to, subject, text, html }
}
const taskFacts = (item, now) => [
  ['Tipo', isTask(item) ? labelOf(taskTypes, item.taskType) : 'Anotação'],
  ...(isTask(item) ? [['Quando', item.dueDate ? `${dateLabel(item.dueDate)}${item.dueTime ? ` às ${item.dueTime}` : ''} (${dueLabel(item, now)})` : 'Sem data']] : []),
  ...(item.place ? [['Local', item.place]] : []),
  ...(item.link ? [['Vinculada a', item.link]] : []),
]
const emailClosing = 'Você recebe este e-mail pelas notificações de Anotações e Tarefas. Para não receber, desligue em Configurações › Anotações e Tarefas no Portal GMAC.'

export default function createNotesRouter(accounts, requireAdmin, { mailer = createMailer(), now = Date.now } = {}) {
  const router = express.Router()
  router.use('/notes', requireAdmin, async (request, _response, next) => {
    try {
      const actor = await accounts.account(request.adminId)
      if (!actor) fail('Entre novamente para usar as anotações.', 401)
      request.viewer = { id: actor.id, name: actor.name }
      next()
    } catch (error) { next(error) }
  })
  const handle = (fn) => async (request, response, next) => { try { await fn(request, response) } catch (error) { next(error) } }
  const find = (store, id) => store.noteItems.find((item) => item.id === id) || fail('Anotação ou tarefa não encontrada.', 404)
  // Only who accepted it (and whoever created it) works on an item; an invitation not answered yet only shows the invite.
  const participant = (item, viewer) => {
    const member = memberOf(item, viewer.id)
    if (!member || member.status !== 'accepted') fail('Você não participa desta anotação ou tarefa.', 403)
    return member
  }

  // The e-mails go after the change is saved and never hold the answer. They follow the account: the notices of
  // Anotações e Tarefas on, "Notificações do sistema por e-mail" on and an e-mail registered.
  async function email(userId, build) {
    try {
      if (!mailer.configured()) return
      const settings = notificationSettings(await readStore(), userId)
      if (!settings.notesNotifications || !settings.emailNotifications) return
      const account = await accounts.account(userId).catch(() => null)
      const address = String(account?.email || '').trim()
      if (!address) return
      await mailer.send(build({ to: address, name: account.name }))
    } catch (error) { console.error('Falha ao enviar o e-mail de Anotações e Tarefas:', error.message) }
  }
  const inviteMail = (item, actor) => (person) => noteMail({
    kind: 'invite', ...person, item,
    subject: `Convite · ${actor.name} compartilhou ${article(item)} "${item.title || 'Anotação'}"`,
    preview: `${actor.name} convidou você para ${article(item)} ${item.title || ''}. Aceite ou recuse no Portal GMAC.`,
    facts: [...taskFacts(item, now()), ['Convidado por', actor.name]],
    message: item.text ? shortText(item.text, 600) : '',
    closing: `Aceite ou recuse em Anotações e Tarefas, no Portal GMAC. ${emailClosing}`,
  })

  // The notices of a change to the other people of a shared item (bell only).
  function tellOthers(store, item, actor, notice) {
    const recipientIds = othersAccepted(item, actor.id).map((member) => member.userId)
    if (recipientIds.length) addNotification(store, { noteId: item.id, noteKind: item.kind, authorId: actor.id, recipientIds, employeeName: actor.name, ...notice })
  }
  function invite(store, item, actor, userIds, at) {
    for (const userId of userIds) addNotification(store, { type: 'note-invite', noteId: item.id, noteKind: item.kind, authorId: actor.id, recipientIds: [userId], title: `Convite para ${article(item)} "${shortText(item.title || item.text, 60)}"`, description: `${actor.name} quer compartilhar com você. Aceite ou recuse em Anotações e Tarefas.`, employeeName: actor.name, at })
  }

  // The people an item can be shared with: everybody of the administrative portal, except whoever asks.
  async function peopleList(viewerId) {
    return (await accounts.people()).filter((person) => !same(person.id, viewerId)).map(({ id, name }) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
  }
  // The invited people of a request: existing accounts, each once, never whoever asks.
  async function readShare(value, viewerId) {
    if (value === undefined) return undefined
    if (!Array.isArray(value)) fail('Lista de pessoas inválida.')
    const people = await peopleList(viewerId)
    const ids = [...new Map(value.map((id) => [String(id), id])).keys()].filter((id) => !same(id, viewerId))
    if (ids.length > SHARE_MAX) fail(`Compartilhe com até ${SHARE_MAX} pessoas.`)
    return ids.map((id) => people.find((person) => same(person.id, id)) || fail('Uma das pessoas escolhidas não tem mais acesso ao portal.'))
  }

  router.get('/notes', handle(async (request, response) => {
    const store = await readStore(); init(store)
    const mine = store.noteItems.filter((item) => memberOf(item, request.viewer.id))
    response.set('Cache-Control', 'no-store').json({
      items: mine.filter((item) => memberOf(item, request.viewer.id).status === 'accepted').map((item) => noteView(item, request.viewer.id)),
      invites: mine.filter((item) => memberOf(item, request.viewer.id).status === 'pending').map((item) => noteView(item, request.viewer.id)),
      viewer: request.viewer,
    })
  }))

  router.get('/notes/people', handle(async (request, response) => {
    response.json({ items: await peopleList(request.viewer.id) })
  }))

  router.post('/notes', handle(async (request, response) => {
    const body = request.body || {}
    const kind = body.kind === 'task' ? 'task' : body.kind === 'note' ? 'note' : fail('Escolha anotação ou tarefa.')
    const reminder = readReminder(body.reminder) ?? defaultReminder
    const share = await readShare(body.share ?? [], request.viewer.id)
    const actor = request.viewer
    const item = await mutateStore((store) => {
      init(store)
      const at = new Date(now()).toISOString()
      const content = readContent(body, kind, {}, store)
      const row = {
        id: randomUUID(), kind, ...content,
        ...(kind === 'task' ? { dueSetAt: at, repeatAnchor: content.dueDate ? Number(content.dueDate.slice(8)) : null } : {}),
        ownerId: actor.id, ownerName: actor.name, createdAt: at, updatedAt: at, updatedById: actor.id, updatedByName: actor.name,
        members: [
          { userId: actor.id, userName: actor.name, role: 'owner', status: 'accepted', reminder, pinned: body.pinned === true },
          ...share.map((person) => ({ userId: person.id, userName: person.name, role: 'member', status: 'pending', invitedAt: at, reminder: defaultReminder })),
        ],
        comments: [], history: [],
      }
      addHistory(row, actor, `criou ${article(row)}${share.length ? ` e convidou ${share.map((person) => person.name).join(', ')}` : ''}`, at)
      store.noteItems.push(row)
      invite(store, row, actor, share.map((person) => person.id), at)
      return row
    })
    for (const person of share) email(person.id, inviteMail(item, actor))
    response.status(201).json({ item: noteView(item, actor.id) })
  }))

  // Editing: whoever created it and whoever accepted it. `baseUpdatedAt` (the version the editor opened) stops a save
  // over a change someone else made meanwhile. Only whoever created it changes who it is shared with (`share`).
  router.put('/notes/:id', handle(async (request, response) => {
    const body = request.body || {}
    const actor = request.viewer
    const share = await readShare(body.share, actor.id)
    const invited = []
    const item = await mutateStore((store) => {
      init(store)
      const row = find(store, request.params.id)
      participant(row, actor)
      if (body.baseUpdatedAt && body.baseUpdatedAt !== row.updatedAt) fail(`${row.updatedByName || 'Outra pessoa'} alterou ${article(row)} enquanto você editava. Feche e abra de novo para ver a versão atual.`, 409)
      if (share !== undefined && !same(row.ownerId, actor.id)) fail('Só quem criou pode mudar com quem está compartilhado.', 403)
      const at = new Date(now()).toISOString()
      const before = { ...row }
      const content = readContent(body, row.kind, row, store)
      Object.assign(row, content)
      const changes = changesOf(before, row)
      if (isTask(row) && (before.dueDate !== row.dueDate || before.dueTime !== row.dueTime)) row.dueSetAt = at
      if (isTask(row) && (before.repeat !== row.repeat || before.dueDate !== row.dueDate) && row.dueDate) row.repeatAnchor = Number(row.dueDate.slice(8))
      const peopleChanges = []
      if (share !== undefined) {
        const wanted = new Set(share.map((person) => String(person.id)))
        for (const member of row.members.filter((entry) => entry.role !== 'owner' && !wanted.has(String(entry.userId)))) {
          peopleChanges.push(`removeu ${member.userName}`)
          if (member.status === 'accepted') addNotification(store, { type: 'note-removed', noteId: row.id, noteKind: row.kind, authorId: actor.id, recipientIds: [member.userId], title: `Você saiu de ${article(row)} compartilhada`, description: `${actor.name} tirou você de "${shortText(row.title || row.text, 60)}".`, employeeName: actor.name, at })
        }
        row.members = row.members.filter((entry) => entry.role === 'owner' || wanted.has(String(entry.userId)))
        for (const person of share) {
          const member = memberOf(row, person.id)
          if (member && member.status !== 'declined') continue
          if (member) Object.assign(member, { status: 'pending', invitedAt: at, respondedAt: null })
          else row.members.push({ userId: person.id, userName: person.name, role: 'member', status: 'pending', invitedAt: at, reminder: defaultReminder })
          invited.push(person)
        }
        if (invited.length) peopleChanges.push(`convidou ${invited.map((person) => person.name).join(', ')}`)
      }
      const reminder = readReminder(body.reminder)
      const me = memberOf(row, actor.id)
      if (reminder !== undefined) me.reminder = reminder
      if (typeof body.pinned === 'boolean') me.pinned = body.pinned
      const all = [...changes, ...peopleChanges]
      if (changes.length) { row.updatedAt = at; row.updatedById = actor.id; row.updatedByName = actor.name }
      if (all.length) addHistory(row, actor, all.join('; '), at)
      if (changes.length) tellOthers(store, row, actor, { type: 'note-change', title: `${actor.name} alterou ${article(row)} "${shortText(row.title || row.text, 60)}"`, description: shortText(changes.join('; '), 160), at })
      invite(store, row, actor, invited.map((person) => person.id), at)
      return row
    })
    for (const person of invited) email(person.id, inviteMail(item, actor))
    response.json({ item: noteView(item, actor.id) })
  }))

  // What is only of the person: their reminder of a task and their pin of an annotation.
  router.patch('/notes/:id/me', handle(async (request, response) => {
    const reminder = readReminder(request.body?.reminder)
    const item = await mutateStore((store) => {
      init(store)
      const row = find(store, request.params.id)
      const me = participant(row, request.viewer)
      if (reminder !== undefined) me.reminder = reminder
      if (typeof request.body?.pinned === 'boolean') me.pinned = request.body.pinned
      return row
    })
    response.json({ item: noteView(item, request.viewer.id) })
  }))

  // Marking an entry of the list (or a subitem) right on the card, without opening the editor.
  router.post('/notes/:id/checklist/:entryId', handle(async (request, response) => {
    if (typeof request.body?.done !== 'boolean') fail('Informe se o item está feito.')
    const item = await mutateStore((store) => {
      init(store)
      const row = find(store, request.params.id)
      participant(row, request.viewer)
      const entry = (row.checklist || []).find((value) => value.id === request.params.entryId) || fail('Item da lista não encontrado.', 404)
      if (entry.done === request.body.done) return row
      entry.done = request.body.done
      const at = new Date(now()).toISOString()
      Object.assign(row, { updatedAt: at, updatedById: request.viewer.id, updatedByName: request.viewer.name })
      addHistory(row, request.viewer, `${entry.done ? 'marcou' : 'desmarcou'} "${entry.text}"`, at)
      return row
    })
    response.json({ item: noteView(item, request.viewer.id) })
  }))

  // Concluding a task. Personal: concluded. Shared: "me" concludes the part of this person (the task stays open for the
  // others, who see it), "all" concludes it for everybody; when the last person concludes their part, it is concluded.
  // A task that repeats goes to its next day instead, open again for everybody.
  router.post('/notes/:id/complete', handle(async (request, response) => {
    const scope = request.body?.scope === 'all' ? 'all' : 'me'
    const actor = request.viewer
    const result = await mutateStore((store) => {
      init(store)
      const row = find(store, request.params.id)
      if (!isTask(row)) fail('Só tarefas são concluídas.')
      const me = participant(row, actor)
      if (row.completedAt) fail('Esta tarefa já está concluída.', 409)
      const at = new Date(now()).toISOString(), shared = othersAccepted(row, actor.id).length > 0
      const everybody = scope === 'all' || !shared
      if (!everybody && me.doneAt) fail('Você já concluiu a sua parte.', 409)
      me.doneAt = at; delete me.doneByAll
      if (everybody) for (const member of accepted(row)) if (!member.doneAt) Object.assign(member, { doneAt: at, doneByAll: true })
      const finished = accepted(row).every((member) => member.doneAt)
      let next = null
      if (finished && row.repeat !== 'none' && row.dueDate) {
        next = nextOccurrence(row.dueDate, row.repeat, bahiaDay(now()), row.repeatAnchor)
        row.dueDate = next; row.dueSetAt = at
        for (const member of row.members) { delete member.doneAt; delete member.doneByAll }
        for (const entry of row.checklist || []) entry.done = false
        addHistory(row, actor, `${shared && scope === 'all' ? 'concluiu para todos' : 'concluiu'}; a próxima fica para ${dateLabel(next)}`, at)
      } else if (finished) {
        Object.assign(row, { completedAt: at, completedById: actor.id, completedByName: actor.name })
        addHistory(row, actor, shared && scope === 'all' ? 'concluiu para todos' : shared ? 'concluiu a parte dele(a); todos concluíram' : 'concluiu a tarefa', at)
      } else addHistory(row, actor, 'concluiu a parte dele(a)', at)
      Object.assign(row, { updatedAt: at, updatedById: actor.id, updatedByName: actor.name })
      const name = `"${shortText(row.title, 60)}"`
      if (shared) tellOthers(store, row, actor, next
        ? { type: 'note-done', title: `${actor.name} concluiu ${name}`, description: `A tarefa se repete: a próxima fica para ${dateLabel(next)}.`, at }
        : finished ? { type: 'note-done', title: `Tarefa concluída: ${name}`, description: scope === 'all' ? `${actor.name} concluiu para todos.` : `${actor.name} concluiu a parte dele(a) e todos já concluíram.`, at }
        : { type: 'note-done', title: `${actor.name} concluiu a parte dele(a) em ${name}`, description: `Ainda em aberto para ${accepted(row).filter((member) => !member.doneAt).map((member) => firstName(member.userName)).join(', ')}.`, at })
      return { row, next }
    })
    response.json({ item: noteView(result.row, actor.id), next: result.next })
  }))

  // Reopening: a concluded task opens again for everybody who did not conclude their own part; otherwise only the part
  // of whoever reopens.
  router.post('/notes/:id/reopen', handle(async (request, response) => {
    const actor = request.viewer
    const item = await mutateStore((store) => {
      init(store)
      const row = find(store, request.params.id)
      if (!isTask(row)) fail('Só tarefas são reabertas.')
      const me = participant(row, actor)
      const at = new Date(now()).toISOString()
      if (row.completedAt) {
        delete row.completedAt; delete row.completedById; delete row.completedByName
        for (const member of row.members) if (member.doneByAll || same(member.userId, actor.id)) { delete member.doneAt; delete member.doneByAll }
        addHistory(row, actor, 'reabriu a tarefa', at)
        tellOthers(store, row, actor, { type: 'note-change', title: `${actor.name} reabriu "${shortText(row.title, 60)}"`, description: 'A tarefa voltou a ficar em aberto.', at })
      } else if (me.doneAt) {
        delete me.doneAt; delete me.doneByAll
        addHistory(row, actor, 'reabriu a parte dele(a)', at)
      } else fail('Esta tarefa já está em aberto.', 409)
      Object.assign(row, { updatedAt: at, updatedById: actor.id, updatedByName: actor.name })
      return row
    })
    response.json({ item: noteView(item, actor.id) })
  }))

  router.post('/notes/:id/comments', handle(async (request, response) => {
    const text = multiline(request.body?.text, COMMENT_MAX)
    if (!text) fail('Escreva o comentário.')
    const actor = request.viewer
    const item = await mutateStore((store) => {
      init(store)
      const row = find(store, request.params.id)
      participant(row, actor)
      const at = new Date(now()).toISOString()
      row.comments = [...(row.comments || []), { id: randomUUID(), at, userId: actor.id, userName: actor.name, text }].slice(-COMMENTS_MAX)
      tellOthers(store, row, actor, { type: 'note-change', title: `${actor.name} comentou em "${shortText(row.title || row.text, 60)}"`, description: shortText(text, 160), at })
      return row
    })
    response.status(201).json({ item: noteView(item, actor.id) })
  }))

  // The answer to an invitation; whoever created the item is told.
  router.post('/notes/:id/answer', handle(async (request, response) => {
    if (typeof request.body?.accept !== 'boolean') fail('Aceite ou recuse o convite.')
    const actor = request.viewer, accept = request.body.accept
    const item = await mutateStore((store) => {
      init(store)
      const row = find(store, request.params.id)
      const me = memberOf(row, actor.id)
      if (!me || me.status !== 'pending') fail('Este convite já foi respondido ou foi cancelado.', 409)
      const at = new Date(now()).toISOString()
      Object.assign(me, { status: accept ? 'accepted' : 'declined', respondedAt: at })
      addHistory(row, actor, accept ? 'aceitou o convite' : 'recusou o convite', at)
      addNotification(store, { type: 'note-answer', noteId: row.id, noteKind: row.kind, authorId: actor.id, recipientIds: [row.ownerId], title: `${actor.name} ${accept ? 'aceitou' : 'recusou'} o convite`, description: `${row.kind === 'task' ? 'Tarefa' : 'Anotação'}: ${shortText(row.title || row.text, 80)}`, employeeName: actor.name, at })
      return row
    })
    response.json({ item: accept ? noteView(item, actor.id) : null })
  }))

  // Leaving a shared item (whoever did not create it): it disappears for this person; the others keep it.
  router.post('/notes/:id/leave', handle(async (request, response) => {
    const actor = request.viewer
    await mutateStore((store) => {
      init(store)
      const row = find(store, request.params.id)
      participant(row, actor)
      if (same(row.ownerId, actor.id)) fail('Quem criou não sai: exclua ou deixe pessoal.', 409)
      const at = new Date(now()).toISOString()
      row.members = row.members.filter((member) => !same(member.userId, actor.id))
      addHistory(row, actor, `saiu d${article(row).slice(0, 1)} ${kindWord(row.kind)}`, at)
      tellOthers(store, row, actor, { type: 'note-change', title: `${actor.name} saiu de "${shortText(row.title || row.text, 60)}"`, description: `${actor.name} não participa mais d${article(row).slice(0, 1)} ${kindWord(row.kind)}.`, at })
      // A task left by the only person who had not concluded it is concluded for whoever stays.
      if (isTask(row) && !row.completedAt && accepted(row).every((member) => member.doneAt) && row.repeat === 'none') Object.assign(row, { completedAt: at, completedById: actor.id, completedByName: actor.name })
    })
    response.json({ ok: true })
  }))

  // Deleting: only whoever created it. The others who had accepted are told.
  router.delete('/notes/:id', handle(async (request, response) => {
    const actor = request.viewer
    await mutateStore((store) => {
      init(store)
      const row = find(store, request.params.id)
      participant(row, actor)
      if (!same(row.ownerId, actor.id)) fail(`Só quem criou exclui ${article(row)}. Você pode sair dela.`, 403)
      store.noteItems = store.noteItems.filter((item) => item.id !== row.id)
      tellOthers(store, row, actor, { type: 'note-removed', title: `${actor.name} excluiu ${article(row)} "${shortText(row.title || row.text, 60)}"`, description: `${row.kind === 'task' ? 'A tarefa compartilhada' : 'A anotação compartilhada'} não existe mais.`, at: new Date(now()).toISOString() })
    })
    response.json({ ok: true })
  }))

  // The reminders of the tasks (each person's own) and the notices of a task near its day (Configurações), checked every
  // minute by the server. Each one is given once: `sent` keeps the day and time (and the choice) it was given for, so
  // a task moved to another day reminds again.
  function dueReminders(store, at) {
    const found = []
    for (const item of store.noteItems || []) {
      if (!isTask(item) || item.completedAt || !item.dueDate) continue
      const moment = dueMoment(item)
      const setAt = Date.parse(item.dueSetAt || item.createdAt)
      for (const member of accepted(item)) {
        if (member.doneAt) continue
        const settings = notificationSettings(store, member.userId)
        const reminder = member.reminder || defaultReminder
        const reminderKey = `${item.dueDate} ${item.dueTime || ''}|${reminder}`
        if (reminder !== 'none' && member.sent?.reminder !== reminderKey && at >= moment - Number(reminder) * 60000 && at < moment + LATE_REMINDER_MS && setAt <= moment) found.push({ item, member, kind: 'reminder', key: reminderKey, quiet: !settings.notesNotifications })
        const days = settings.notesDueDays
        const dueKey = `${item.dueDate}|${days}`
        const noticeAt = momentOf(addDays(item.dueDate, -days), dueNoticeTime)
        if (member.sent?.due !== dueKey && settings.notesDueReminder && at >= noticeAt && bahiaDay(at) < item.dueDate && setAt < noticeAt) found.push({ item, member, kind: 'due', key: dueKey, days, quiet: !settings.notesNotifications })
      }
    }
    return found
  }
  let sweeping = null
  async function sweep() {
    if (sweeping) return sweeping
    sweeping = (async () => {
      const at = now()
      if (!dueReminders(await readStore(), at).length) return []
      const given = await mutateStore((store) => {
        init(store)
        const list = dueReminders(store, at)
        for (const { item, member, kind, key, days, quiet } of list) {
          member.sent = { ...member.sent, [kind]: key }
          // With the notices of Anotações e Tarefas off, the reminder is only marked as given.
          if (quiet) continue
          const label = dueLabel(item, at)
          if (kind === 'reminder') addNotification(store, { id: `note-reminder:${item.id}:${member.userId}:${key}`, type: 'note-reminder', noteId: item.id, noteKind: item.kind, recipientIds: [member.userId], title: `Lembrete: ${item.title}`, description: `${label[0].toUpperCase()}${label.slice(1)}${item.place ? ` · ${item.place}` : ''}`, at: new Date(at).toISOString() })
          else addNotification(store, { id: `note-due:${item.id}:${member.userId}:${key}`, type: 'note-due', noteId: item.id, noteKind: item.kind, recipientIds: [member.userId], title: `Prazo chegando: ${item.title}`, description: `${label[0].toUpperCase()}${label.slice(1)} · aviso de ${days} ${days === 1 ? 'dia' : 'dias'} antes`, at: new Date(at).toISOString() })
        }
        return list.filter((entry) => !entry.quiet).map(({ item, member, kind, days }) => ({ item: structuredClone(item), userId: member.userId, kind, days }))
      })
      for (const { item, userId, kind, days } of given) {
        const label = dueLabel(item, at)
        await email(userId, (person) => noteMail({
          kind, ...person, item,
          subject: kind === 'reminder' ? `Lembrete · ${item.title} · ${label}` : `Prazo chegando · ${item.title} · ${label}`,
          preview: kind === 'reminder' ? `${item.title}: ${label}${item.place ? ` · ${item.place}` : ''}` : `${item.title} é ${label} (aviso de ${days} ${days === 1 ? 'dia' : 'dias'} antes).`,
          facts: [...taskFacts(item, at), ...(item.members.length > 1 ? [['Com', item.members.filter((member) => member.status === 'accepted' && !same(member.userId, userId)).map((member) => member.userName).join(', ')]] : [])],
          message: item.text ? shortText(item.text, 600) : '',
          closing: `Abra a tarefa em Anotações e Tarefas, no Portal GMAC. ${emailClosing}`,
        }))
      }
      return given
    })().finally(() => { sweeping = null })
    return sweeping
  }
  router.sweep = sweep
  return router
}

