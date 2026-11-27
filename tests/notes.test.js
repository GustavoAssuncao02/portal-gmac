import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowFixture } from './workflowFixture.js'
import { nextOccurrence, taskGroup, dueLabel, momentOf } from '../server/noteRules.js'

// Anotações e Tarefas (2026-11-24): personal or shared annotations and tasks of the administrative portal. Sharing needs
// an accepted invitation; everybody who accepted edits; only whoever created deletes; a shared task is concluded "só para
// mim" or "para todos"; each person has their own reminder and the notice some days before (Configurações).
const env = { DEMO_ADMIN_CPF: '12345678901', DEMO_ADMIN_PASSWORD: 'teste123', DEMO_ADMIN_NAME: 'Administradora' }
const person = (index) => ({ name: `Funcionário ${index}`, birthDate: '1990-01-01', cpf: `0000000000${index}`, email: `funcionario${index}@example.invalid`, identification: '', type: 'administrative', password: 'senha123' })
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const until = async (check) => { for (let tries = 0; tries < 50 && !await check(); tries += 1) await wait(40); return check() }

async function people(fixture, indexes) {
  const result = []
  for (const index of indexes) {
    assert.equal((await fixture.adminRequest('/employees', 'POST', person(index))).status, 201)
    const login = await fixture.request('/auth/login', 'POST', { cpf: `0000000000${index}`, password: 'senha123' })
    const headers = { Authorization: `Bearer ${login.data.token}` }
    const call = (route, method = 'GET', body) => fixture.request(route, method, body, headers)
    result.push(Object.assign(call, { id: login.data.user.id, email: `funcionario${index}@example.invalid` }))
  }
  return result
}
const bell = async (call, type) => (await call('/notifications')).data.items.filter((item) => !type || item.type === type)

test('sharing needs an accepted invitation, everybody who accepted edits and only whoever created deletes', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    assert.equal((await fixture.request('/notes')).status, 401, 'only the administrative portal')
    const [ana, bia, caio] = await people(fixture, [4, 5, 6])

    // The people to share with: everybody of the administrative portal but whoever asks.
    const list = (await ana('/notes/people')).data.items
    assert.ok(list.some((row) => row.id === bia.id) && list.some((row) => row.id === caio.id))
    assert.ok(!list.some((row) => row.id === ana.id))

    // Validation.
    assert.equal((await ana('/notes', 'POST', { kind: 'note' })).status, 400, 'an empty annotation')
    assert.equal((await ana('/notes', 'POST', { kind: 'task', title: ' ' })).status, 400, 'a task needs a title')
    assert.equal((await ana('/notes', 'POST', { kind: 'task', title: 'Ligar', dueTime: '10:00' })).status, 400, 'a time needs a day')
    assert.equal((await ana('/notes', 'POST', { kind: 'task', title: 'Ligar', repeat: 'weekly' })).status, 400, 'a repetition needs a day')
    assert.equal((await ana('/notes', 'POST', { kind: 'note', title: 'OS', link: 'OS-2026-9999' })).status, 400, 'the linked OS must exist')
    assert.equal((await ana('/notes', 'POST', { kind: 'note', title: 'OS', share: ['nobody'] })).status, 400, 'only people of the portal')

    // A personal annotation stays with whoever wrote it.
    const personal = (await ana('/notes', 'POST', { kind: 'note', title: 'Só minha', text: 'Rascunho' })).data.item
    assert.equal(personal.shared, false)
    assert.equal((await bia('/notes')).data.items.length, 0)
    assert.equal((await bia(`/notes/${personal.id}`, 'PUT', { title: 'Invadida' })).status, 403)

    // A shared one is an invitation until it is accepted.
    const created = await ana('/notes', 'POST', { kind: 'note', title: 'Reunião com fornecedor', text: 'Levar amostras', share: [bia.id, caio.id, ana.id, bia.id] })
    assert.equal(created.status, 201)
    const note = created.data.item
    assert.equal(note.shared, true)
    assert.deepEqual(note.participants.map((row) => [row.userId, row.role, row.status]), [[ana.id, 'owner', 'accepted'], [bia.id, 'member', 'pending'], [caio.id, 'member', 'pending']], 'each person once, never whoever creates')
    const invited = (await bia('/notes')).data
    assert.deepEqual([invited.items.length, invited.invites.map((row) => row.id)], [0, [note.id]])
    assert.equal((await bia(`/notes/${note.id}`, 'PUT', { title: 'Antes de aceitar' })).status, 403, 'an invitation is not edited')
    assert.equal((await bell(bia, 'note-invite')).filter((row) => row.noteId === note.id).length, 1, 'the bell tells about the invitation')
    assert.ok(await until(() => fixture.notesMail.filter((mail) => mail.subject.startsWith('Convite')).length === 2), 'and the e-mail too')
    assert.deepEqual(fixture.notesMail.map((mail) => mail.to).sort(), [bia.email, caio.email])
    assert.match(fixture.notesMail[0].html, /Reunião com fornecedor/)

    // Accepting and declining: whoever created it is told.
    assert.equal((await bia(`/notes/${note.id}/answer`, 'POST', { accept: true })).data.item.me.status, 'accepted')
    assert.equal((await caio(`/notes/${note.id}/answer`, 'POST', { accept: false })).data.item, null)
    assert.equal((await caio(`/notes/${note.id}/answer`, 'POST', { accept: true })).status, 409, 'answered once')
    assert.deepEqual((await bell(ana, 'note-answer')).map((row) => row.title).sort(), ['Funcionário 5 aceitou o convite', 'Funcionário 6 recusou o convite'])
    assert.deepEqual([(await caio('/notes')).data.items.length, (await caio('/notes')).data.invites.length], [0, 0])

    // Everybody who accepted edits it; the others are told; an old version is not saved over a newer one.
    const opened = (await bia('/notes')).data.items[0]
    const edited = await bia(`/notes/${note.id}`, 'PUT', { title: 'Reunião com fornecedor X', baseUpdatedAt: opened.updatedAt })
    assert.equal(edited.status, 200)
    assert.match(edited.data.item.history.at(-1).text, /mudou o título/)
    assert.equal((await bell(ana, 'note-change')).filter((row) => row.noteId === note.id).length, 1)
    assert.equal((await bell(bia, 'note-change')).length, 0, 'not to whoever changed it')
    const stale = await ana(`/notes/${note.id}`, 'PUT', { text: 'Versão antiga', baseUpdatedAt: opened.updatedAt })
    assert.equal(stale.status, 409)
    assert.match(stale.data.message, /Funcionário 5 alterou a anotação enquanto você editava/)
    assert.equal((await bia(`/notes/${note.id}`, 'PUT', { share: [] })).status, 403, 'only whoever created changes the people')

    // Comments and the list, on the card.
    const commented = await bia(`/notes/${note.id}/comments`, 'POST', { text: 'Confirmei o horário.' })
    assert.equal(commented.status, 201)
    assert.equal(commented.data.item.comments.at(-1).userName, 'Funcionário 5')
    const listed = (await ana(`/notes/${note.id}`, 'PUT', { checklist: [{ text: 'Amostras' }, { text: 'Catálogo' }] })).data.item
    const checked = await bia(`/notes/${note.id}/checklist/${listed.checklist[0].id}`, 'POST', { done: true })
    assert.deepEqual(checked.data.item.checklist.map((entry) => entry.done), [true, false])
    assert.match(checked.data.item.history.at(-1).text, /marcou "Amostras"/)

    // A declined person invited again gets a new invitation; a person taken out is told.
    await ana(`/notes/${note.id}`, 'PUT', { share: [bia.id, caio.id] })
    assert.deepEqual((await caio('/notes')).data.invites.map((row) => row.id), [note.id])
    await ana(`/notes/${note.id}`, 'PUT', { share: [caio.id] })
    assert.equal((await bia('/notes')).data.items.length, 0)
    assert.equal((await bell(bia, 'note-removed')).length, 1)
    await ana(`/notes/${note.id}`, 'PUT', { share: [bia.id, caio.id] })
    await bia(`/notes/${note.id}/answer`, 'POST', { accept: true })

    // Only whoever created deletes; the others leave.
    const refused = await bia(`/notes/${note.id}`, 'DELETE')
    assert.equal(refused.status, 403)
    assert.match(refused.data.message, /Só quem criou exclui/)
    assert.equal((await ana(`/notes/${note.id}/leave`, 'POST')).status, 409, 'whoever created does not leave')
    assert.equal((await bia(`/notes/${note.id}/leave`, 'POST')).status, 200)
    assert.equal((await bia('/notes')).data.items.length, 0)
    assert.ok((await ana('/notes')).data.items.some((row) => row.id === note.id), 'the others keep it')
    assert.equal((await ana(`/notes/${note.id}`, 'DELETE')).status, 200)
    assert.equal((await ana('/notes')).data.items.some((row) => row.id === note.id), false)
    assert.equal((await caio('/notes')).data.invites.length, 0, 'a pending invitation of a deleted item disappears')
  } finally { await fixture.close() }
})

test('a shared task is concluded only for me or for everybody, reopened, and a repeating one goes to its next day', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const [ana, bia] = await people(fixture, [4, 5])
    fixture.notesClock.now = Date.parse('2026-12-01T10:00:00-03:00')

    const task = (await ana('/notes', 'POST', { kind: 'task', title: 'Conferir estoque', dueDate: '2026-12-01', share: [bia.id] })).data.item
    await bia(`/notes/${task.id}/answer`, 'POST', { accept: true })

    // "Só para mim": done for whoever concluded, still open for the others, who see who did it.
    const mine = await bia(`/notes/${task.id}/complete`, 'POST', { scope: 'me' })
    assert.deepEqual([mine.status, mine.data.item.done, mine.data.item.completedAt ?? null], [200, true, null])
    const seen = (await ana('/notes')).data.items.find((row) => row.id === task.id)
    assert.equal(seen.done, false)
    assert.ok(seen.participants.find((row) => row.userId === bia.id).doneAt)
    assert.match((await bell(ana, 'note-done'))[0].title, /Funcionário 5 concluiu a parte dele\(a\)/)
    assert.equal((await bia(`/notes/${task.id}/complete`, 'POST', { scope: 'me' })).status, 409)

    // The last part concludes the task; reopening opens it again for whoever reopens, not for who did their part.
    const last = await ana(`/notes/${task.id}/complete`, 'POST', { scope: 'me' })
    assert.ok(last.data.item.completedAt)
    assert.equal(taskGroup(last.data.item, last.data.item.done, fixture.notesClock.now), 'done')
    const reopened = await ana(`/notes/${task.id}/reopen`, 'POST')
    assert.deepEqual([reopened.data.item.completedAt ?? null, reopened.data.item.done], [null, false])
    assert.equal((await bia('/notes')).data.items.find((row) => row.id === task.id).done, true, 'her part stays done')

    // "Para todos": concluded for everybody; reopening opens it again for everybody concluded by it (whoever concluded it
    // did their part).
    const other = (await ana('/notes', 'POST', { kind: 'task', title: 'Pedir orçamento', share: [bia.id] })).data.item
    await bia(`/notes/${other.id}/answer`, 'POST', { accept: true })
    const all = await bia(`/notes/${other.id}/complete`, 'POST', { scope: 'all' })
    assert.ok(all.data.item.completedAt)
    assert.equal((await ana('/notes')).data.items.find((row) => row.id === other.id).done, true)
    assert.equal((await bell(ana, 'note-done')).filter((row) => row.noteId === other.id)[0].description, 'Funcionário 5 concluiu para todos.')
    await ana(`/notes/${other.id}/reopen`, 'POST')
    assert.deepEqual([(await ana('/notes')).data.items.find((row) => row.id === other.id).done, (await bia('/notes')).data.items.find((row) => row.id === other.id).done], [false, true])
    const third = (await ana('/notes', 'POST', { kind: 'task', title: 'Revisar contrato', share: [bia.id] })).data.item
    await bia(`/notes/${third.id}/answer`, 'POST', { accept: true })
    await ana(`/notes/${third.id}/complete`, 'POST', { scope: 'all' })
    await bia(`/notes/${third.id}/reopen`, 'POST')
    assert.deepEqual([(await ana('/notes')).data.items.find((row) => row.id === third.id).done, (await bia('/notes')).data.items.find((row) => row.id === third.id).done], [true, false])

    // A personal task is simply concluded.
    const alone = (await ana('/notes', 'POST', { kind: 'task', title: 'Pagar boleto' })).data.item
    assert.ok((await ana(`/notes/${alone.id}/complete`, 'POST', { scope: 'me' })).data.item.completedAt)
    assert.equal((await ana(`/notes/${alone.id}/complete`, 'POST', {})).status, 409)

    // A repeating task goes to its next day, open again and with the subitems unmarked.
    const weekly = (await ana('/notes', 'POST', { kind: 'task', title: 'Reunião semanal', taskType: 'meeting', place: 'Sala 2', dueDate: '2026-12-01', dueTime: '09:00', repeat: 'weekly', checklist: [{ text: 'Pauta', done: true }], share: [bia.id] })).data.item
    await bia(`/notes/${weekly.id}/answer`, 'POST', { accept: true })
    const moved = await ana(`/notes/${weekly.id}/complete`, 'POST', { scope: 'all' })
    assert.equal(moved.data.next, '2026-12-08')
    assert.deepEqual([moved.data.item.dueDate, moved.data.item.done, moved.data.item.completedAt ?? null, moved.data.item.checklist[0].done, moved.data.item.place], ['2026-12-08', false, null, false, 'Sala 2'])
    assert.match((await bell(bia, 'note-done')).find((row) => row.noteId === weekly.id).description, /próxima fica para/)
    assert.equal((await ana(`/notes/${task.id}/complete`, 'POST', { scope: 'all' })).status, 200)
    assert.equal((await ana('/notes/nothing/complete', 'POST', {})).status, 404)
    const note = (await ana('/notes', 'POST', { kind: 'note', title: 'Ideia' })).data.item
    assert.equal((await ana(`/notes/${note.id}/complete`, 'POST', {})).status, 400, 'annotations are not concluded')
  } finally { await fixture.close() }
})

test('the reminders and the notice near the day follow each person, once, by bell and e-mail', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const [ana, bia, caio, davi] = await people(fixture, [4, 5, 6, 7])
    const at = (text) => { fixture.notesClock.now = Date.parse(`${text}-03:00`) }
    const sweep = async (text) => { at(text); return (await fixture.notesSweep()).map((row) => `${row.kind}:${row.userId}`).sort() }
    // Bia: reminder one day before and no e-mail; Caio: the notices of Anotações e Tarefas off; Davi: 3 days before.
    assert.equal((await bia('/account/notifications', 'PATCH', { emailNotifications: false })).status, 200)
    assert.equal((await caio('/account/notifications', 'PATCH', { notesNotifications: false })).status, 200)
    assert.equal((await davi('/account/notifications', 'PATCH', { notesDueDays: 3 })).status, 200)

    at('2026-11-28T10:00:00')
    const task = (await ana('/notes', 'POST', { kind: 'task', title: 'Enviar relatório', dueDate: '2026-12-03', dueTime: '09:00', reminder: '60', share: [bia.id, caio.id, davi.id] })).data.item
    for (const call of [bia, caio, davi]) await call(`/notes/${task.id}/answer`, 'POST', { accept: true })
    await bia(`/notes/${task.id}/me`, 'PATCH', { reminder: '1440' })
    assert.equal((await bia(`/notes/${task.id}/me`, 'PATCH', { reminder: '30' })).status, 400, 'a reminder of the list')
    assert.ok(await until(() => fixture.notesMail.length === 1), 'only Davi gets the invitation by e-mail')
    assert.equal(fixture.notesMail[0].to, davi.email)
    fixture.notesMail.length = 0

    // The notice of a task near its day comes at 07:30 (08:00 until 2026-11-26).
    assert.deepEqual(await sweep('2026-11-30T07:29:00'), [])
    assert.deepEqual(await sweep('2026-11-30T07:30:00'), [`due:${davi.id}`], '3 days before, at 07:30')
    assert.deepEqual(await sweep('2026-11-30T09:00:00'), [], 'once')
    assert.deepEqual(await sweep('2026-12-02T08:00:00'), [`due:${ana.id}`, `due:${bia.id}`].sort(), 'the default is 1 day before; Caio is only marked')
    assert.deepEqual(await sweep('2026-12-02T09:00:00'), [`reminder:${bia.id}`], 'her own reminder, 1 day before')
    assert.deepEqual(await sweep('2026-12-03T07:59:00'), [])
    assert.deepEqual(await sweep('2026-12-03T08:00:00'), [`reminder:${ana.id}`, `reminder:${davi.id}`].sort(), '1 hour before; Caio quiet')
    assert.deepEqual(await sweep('2026-12-03T08:30:00'), [])

    // The bell: each person sees only their own notices; with the notices off, nothing.
    assert.deepEqual((await bell(ana)).filter((row) => row.type.startsWith('note-') && row.noteId === task.id && ['note-due', 'note-reminder'].includes(row.type)).map((row) => row.type).sort(), ['note-due', 'note-reminder'])
    assert.equal((await bell(ana, 'note-reminder'))[0].title, 'Lembrete: Enviar relatório')
    assert.equal((await bell(caio)).filter((row) => row.type.startsWith('note-')).length, 0)
    assert.match((await bell(davi, 'note-due'))[0].description, /aviso de 3 dias antes/)

    // E-mails: Ana and Davi; Bia turned off the e-mails of the system; Caio the notices of Anotações e Tarefas.
    assert.ok(await until(() => fixture.notesMail.length === 4))
    assert.deepEqual(fixture.notesMail.map((mail) => `${mail.to} ${mail.subject.split(' · ')[0]}`).sort(), [`${ana.email} Lembrete`, `${ana.email} Prazo chegando`, `${davi.email} Lembrete`, `${davi.email} Prazo chegando`])
    assert.match(fixture.notesMail.find((mail) => mail.to === ana.email && mail.subject.startsWith('Lembrete')).text, /Com: Funcionário 5, Funcionário 6, Funcionário 7/)

    // A task moved to another day reminds again; whoever concluded their part is not reminded; the notice can be off.
    at('2026-12-03T08:40:00')
    await ana(`/notes/${task.id}`, 'PUT', { dueDate: '2026-12-05' })
    await davi(`/notes/${task.id}/complete`, 'POST', { scope: 'me' })
    await ana('/account/notifications', 'PATCH', { notesDueReminder: false })
    assert.deepEqual(await sweep('2026-12-04T08:00:00'), [`due:${bia.id}`])
    assert.deepEqual(await sweep('2026-12-04T09:00:00'), [`reminder:${bia.id}`])
    assert.deepEqual(await sweep('2026-12-05T08:00:00'), [`reminder:${ana.id}`])
    // A task created after the moment of the notice gets only the reminder; a concluded task, nothing.
    at('2026-12-05T08:30:00')
    const late = (await bia('/notes', 'POST', { kind: 'task', title: 'Ligar para o cliente', dueDate: '2026-12-06', dueTime: '10:00', reminder: '15' })).data.item
    assert.deepEqual(await sweep('2026-12-06T09:45:00'), [`reminder:${bia.id}`])
    assert.equal(late.shared, false)
    await ana(`/notes/${task.id}/complete`, 'POST', { scope: 'all' })
    assert.deepEqual(await sweep('2026-12-07T10:00:00'), [])
  } finally { await fixture.close() }
})

test('the settings of Anotações e Tarefas are saved one by one, strict, and Minha conta shows the last password change', async () => {
  const fixture = await createWorkflowFixture({ accountsEnv: env })
  try {
    const [ana, bia] = await people(fixture, [4, 5])
    const defaults = (await ana('/account/notifications')).data.settings
    assert.deepEqual([defaults.notesButton, defaults.notesNotifications, defaults.notesDueReminder, defaults.notesDueDays], [true, true, true, 1])
    for (const body of [{ notesDueDays: 4 }, { notesDueDays: '2' }, { notesButton: 'sim' }, { notesNotifications: 1 }, { notesDueReminder: null }]) assert.equal((await ana('/account/notifications', 'PATCH', body)).status, 400, JSON.stringify(body))
    const saved = await ana('/account/notifications', 'PATCH', { notesButton: false })
    assert.deepEqual([saved.data.settings.notesButton, saved.data.settings.notesNotifications, saved.data.settings.supportTickets, saved.data.settings.sound], [false, true, true, defaults.sound], 'one change at a time keeps the rest')
    assert.equal((await ana('/account/notifications', 'PATCH', { notesDueDays: 7 })).data.settings.notesDueDays, 7)
    assert.equal((await bia('/account/notifications')).data.settings.notesButton, true, 'one account does not change another')

    // The bell hides the notices of Anotações e Tarefas of whoever turned them off.
    await bia('/account/notifications', 'PATCH', { notesNotifications: false })
    await ana('/notes', 'POST', { kind: 'note', title: 'Para a Bia', share: [bia.id] })
    assert.equal((await bell(bia, 'note-invite')).length, 0)
    assert.equal((await bia('/notes')).data.invites.length, 1, 'the invitation is still there to answer')
    await bia('/account/notifications', 'PATCH', { notesNotifications: true })
    assert.equal((await bell(bia, 'note-invite')).length, 1)
    await wait(100)
    assert.equal(fixture.notesMail.length, 0, 'no e-mail while the notices were off')

    // "Senha: alterada em" comes from the record of the password changes.
    assert.deepEqual((await ana('/account/password-changed')).data, { at: null })
    const account = await ana('/account', 'PATCH', { name: 'Funcionário 4', currentPassword: 'senha123', password: 'nova1234' })
    assert.equal(account.status, 200)
    assert.equal((await ana('/account/password-changed')).status, 401, 'the change of password ends the old sessions')
    const changed = (await fixture.request('/account/password-changed', 'GET', undefined, { Authorization: `Bearer ${account.data.token}` })).data.at
    assert.ok(changed && Date.now() - Date.parse(changed) < 60000)
    assert.deepEqual((await bia('/account/password-changed')).data, { at: null }, 'only the own changes')
    assert.equal((await fixture.request('/account/password-changed')).status, 401)
  } finally { await fixture.close() }
})

test('the rules of the days: next occurrences, groups and labels in the time of Bahia', () => {
  assert.equal(nextOccurrence('2026-01-31', 'monthly', '2026-01-31', 31), '2026-02-28', 'the end of a shorter month')
  assert.equal(nextOccurrence('2026-02-28', 'monthly', '2026-02-28', 31), '2026-03-31', 'and back to its day')
  assert.equal(nextOccurrence('2026-11-02', 'daily', '2026-11-24', 2), '2026-11-24', 'never a day already past')
  assert.equal(nextOccurrence('2026-11-24', 'weekly', '2026-11-24', 24), '2026-12-01')
  const now = Date.parse('2026-11-24T15:00:00-03:00')
  assert.equal(taskGroup({ kind: 'task', dueDate: '2026-11-23' }, false, now), 'late')
  assert.equal(taskGroup({ kind: 'task', dueDate: '2026-11-24', dueTime: '14:00' }, false, now), 'late')
  assert.equal(taskGroup({ kind: 'task', dueDate: '2026-11-24', dueTime: '16:00' }, false, now), 'today')
  assert.equal(taskGroup({ kind: 'task', dueDate: '2026-11-25' }, false, now), 'upcoming')
  assert.equal(taskGroup({ kind: 'task' }, false, now), 'nodate')
  assert.equal(dueLabel({ dueDate: '2026-11-24', dueTime: '16:00' }, now), 'hoje, 16:00')
  assert.equal(dueLabel({ dueDate: '2026-11-25' }, now), 'amanhã')
  assert.equal(new Date(momentOf('2026-11-25', '08:00')).toISOString(), '2026-11-25T11:00:00.000Z')
})
