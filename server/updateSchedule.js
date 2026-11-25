import { randomUUID } from 'node:crypto'
import { addNotification } from './notificationEvents.js'

// Programar atualização (Desenvolvedor, 2026-11-25): a developer picks the day and the hour of an update of the portal.
// Everybody of the administrative portal is told in the bell when it is scheduled, rescheduled or canceled, and again 5
// minutes before; the screens show a small countdown in the last 2 minutes (the operators' tablets are left as they are).
// At the hour, with the SaveInCloud token configured (SAVEINCLOUD_TOKEN + SAVEINCLOUD_ENV), the server asks the hosting
// for the same "Atualizar" of the ROOT deployment (pull of GitHub + restart); without it, the developers get a notice to
// do it by hand. The next start of the server marks the update as done. Times are of America/Bahia (no daylight saving).
const MINUTE = 60000
export const WARN_BEFORE_MS = 5 * MINUTE
export const COUNTDOWN_MS = 2 * MINUTE
// At least 10 minutes ahead, so both notices (on scheduling and 5 minutes before) reach people in time.
export const MIN_LEAD_MS = 10 * MINUTE
export const MAX_AHEAD_MS = 90 * 24 * 60 * MINUTE
// A server that was down at the hour does not update by surprise when it comes back: after 10 minutes it is not run.
export const LATE_LIMIT_MS = 10 * MINUTE
const BAHIA_OFFSET = '-03:00'
const DEPLOY_TIMEOUT_MS = 2 * MINUTE

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

// "2026-11-26" + "19:00" in Bahia → milliseconds, or null when the date or the hour is not valid.
export function scheduleMoment(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) return null
  const ms = Date.parse(`${date}T${time}:00${BAHIA_OFFSET}`)
  if (!Number.isFinite(ms)) return null
  // Rejects days that do not exist (2026-02-30 would roll over to March).
  return new Date(ms - 3 * 60 * MINUTE).toISOString().slice(0, 10) === date ? ms : null
}
const parts = (ms) => Object.fromEntries(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((part) => [part.type, part.value]))
// "26/11 às 19:00"
export function momentLabel(ms) { const p = parts(ms); return `${p.day}/${p.month} às ${p.hour}:${p.minute}` }
export const hourLabel = (ms) => { const p = parts(ms); return `${p.hour}:${p.minute}` }

// The SaveInCloud (Jelastic/Virtuozzo) access to update the ROOT deployment, or null when it is not configured. The token
// only needs the API method environment.Vcs.Update. Its value never leaves this module (not in logs, screens or exports).
export function deployConfig(env = process.env) {
  const token = String(env.SAVEINCLOUD_TOKEN || '').trim(), envName = String(env.SAVEINCLOUD_ENV || '').trim()
  const api = String(env.SAVEINCLOUD_API_URL || 'https://app.paas.saveincloud.net.br').trim().replace(/\/+$/, '')
  if (!token || !envName || !/^https:\/\/[^/\s]+$/.test(api)) return null
  return { token, envName, api, context: String(env.SAVEINCLOUD_CONTEXT || '').trim() || 'ROOT', nodeGroup: String(env.SAVEINCLOUD_NODE_GROUP || '').trim() || 'cp' }
}
// The same as the "Atualizar" button of the deployment: pulls the branch of GitHub and restarts the Node.js node. The
// hosting answers only when it is done, and by then this process has usually been restarted, so the answer is often lost.
export async function requestDeploy(config, { fetchImpl = fetch, timeoutMs = DEPLOY_TIMEOUT_MS } = {}) {
  const body = new URLSearchParams({ envName: config.envName, session: config.token, context: config.context, project: config.context, nodeGroup: config.nodeGroup })
  const response = await fetchImpl(`${config.api}/1.0/environment/vcs/rest/update`, { method: 'POST', body, signal: AbortSignal.timeout(timeoutMs) })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data || data.result !== 0) throw new Error(clean(data?.error || data?.reason || data?.message || `resposta HTTP ${response.status}`, 300))
  return data
}

const activeStatuses = new Set(['scheduled', 'started'])
export const activeSchedule = (store) => (store.updateSchedules || []).find((row) => activeStatuses.has(row.status)) || null
const actorOf = (actor) => ({ id: actor?.id ?? null, name: actor?.name || 'Sistema' })
const publicMessage = (row) => row.message ? ` ${row.message}` : ''

function noticeAll(store, row, kind, title, description, at) {
  addNotification(store, { id: `update:${row.id}:${kind}`, type: 'system-update', at: new Date(at).toISOString(), scheduleId: row.id, title, description })
}
function noticeDevelopers(store, row, kind, title, description, at, developerIds) {
  addNotification(store, { id: `update:${row.id}:${kind}`, type: 'system-update', developer: true, at: new Date(at).toISOString(), scheduleId: row.id, recipientIds: developerIds, title, description })
}

// What the screens need for the countdown: the update in progress or the next one, without who scheduled it.
export function nextUpdateView(store) {
  const row = activeSchedule(store)
  return row ? { id: row.id, at: row.at, status: row.status, message: row.message || '' } : null
}
export const scheduleView = (row) => ({ id: row.id, at: row.at, message: row.message || '', status: row.status, mode: row.mode || null, createdAt: row.createdAt, createdBy: row.createdBy?.name || null, canceledAt: row.canceledAt || null, canceledBy: row.canceledBy?.name || null, startedAt: row.startedAt || null, doneAt: row.doneAt || null, doneBy: row.doneBy?.name || null, versionBefore: row.versionBefore || null, versionAfter: row.versionAfter || null, error: row.error || null, history: row.history || [] })

// `version`: the running version (newest entry of the release notes). `developerIds()`: the accounts of the developers.
export function createUpdateScheduler({ readStore, mutateStore, developerIds = async () => [], version = null, env = process.env, deploy = requestDeploy, now = Date.now, log = () => {} }) {
  const config = () => deployConfig(env)

  function validMoment(date, time, at = now()) {
    const ms = scheduleMoment(date, time)
    if (ms == null) fail('Informe uma data e uma hora válidas.')
    if (ms - at < MIN_LEAD_MS) fail('Programe a atualização com pelo menos 10 minutos de antecedência, para os avisos chegarem a tempo.')
    if (ms - at > MAX_AHEAD_MS) fail('Programe a atualização para no máximo 90 dias a partir de hoje.')
    return ms
  }
  const find = (store, id) => (store.updateSchedules || []).find((row) => row.id === id) || fail('Atualização programada não encontrada.', 404)

  async function list() {
    const store = await readStore()
    const items = [...(store.updateSchedules || [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 15).map(scheduleView)
    return { items, automatic: Boolean(config()), environment: config()?.envName || null, version }
  }

  async function create(body, actor) {
    const at = now(), ms = validMoment(body?.date, body?.time, at), message = clean(body?.message, 300)
    return mutateStore((store) => {
      store.updateSchedules ||= []
      const current = activeSchedule(store)
      if (current) fail(`Já existe uma atualização ${current.status === 'started' ? 'em andamento' : `programada para ${momentLabel(Date.parse(current.at))}`}. Remarque ou cancele a atual.`, 409)
      const row = { id: randomUUID(), at: new Date(ms).toISOString(), message, status: 'scheduled', createdAt: new Date(at).toISOString(), createdBy: actorOf(actor), version, history: [] }
      store.updateSchedules.push(row)
      if (store.updateSchedules.length > 60) store.updateSchedules.splice(0, store.updateSchedules.length - 60)
      noticeAll(store, row, 'scheduled', 'Atualização do portal programada', `O portal será atualizado em ${momentLabel(ms)} e pode ficar fora do ar por alguns minutos.${publicMessage(row)}`, at)
      return scheduleView(row)
    })
  }

  async function reschedule(id, body, actor) {
    const at = now(), ms = validMoment(body?.date, body?.time, at)
    return mutateStore((store) => {
      const row = find(store, id)
      if (row.status !== 'scheduled') fail('Só uma atualização ainda programada pode ser remarcada.', 409)
      if (body?.message !== undefined) row.message = clean(body.message, 300)
      const before = Date.parse(row.at)
      if (before !== ms) {
        row.history ||= []
        row.history.push({ at: new Date(at).toISOString(), by: actorOf(actor).name, from: row.at, to: new Date(ms).toISOString() })
        row.at = new Date(ms).toISOString()
        delete row.warnedAt
        noticeAll(store, row, `rescheduled-${row.history.length}`, 'Atualização do portal remarcada', `A atualização de ${momentLabel(before)} passou para ${momentLabel(ms)}.${publicMessage(row)}`, at)
      }
      return scheduleView(row)
    })
  }

  async function cancel(id, actor) {
    const at = now()
    return mutateStore((store) => {
      const row = find(store, id)
      if (row.status !== 'scheduled') fail('Só uma atualização ainda programada pode ser cancelada.', 409)
      Object.assign(row, { status: 'canceled', canceledAt: new Date(at).toISOString(), canceledBy: actorOf(actor) })
      noticeAll(store, row, 'canceled', 'Atualização do portal cancelada', `A atualização de ${momentLabel(Date.parse(row.at))} foi cancelada.`, at)
      return scheduleView(row)
    })
  }

  // An update started by hand that did not restart the server (or that the developer gave up) is closed here.
  async function finish(id, actor) {
    const at = now()
    return mutateStore((store) => {
      const row = find(store, id)
      if (row.status !== 'started') fail('Só uma atualização em andamento pode ser marcada como concluída.', 409)
      Object.assign(row, { status: 'done', doneAt: new Date(at).toISOString(), doneBy: actorOf(actor), versionAfter: version })
      return scheduleView(row)
    })
  }

  // Each start of the server: an update in progress is done (the restart is the update); one programmed for the next
  // minutes that the developer already made by hand (the version changed) is done too; one whose hour passed while the
  // server was down is not run anymore.
  async function boot() {
    const at = now(), snapshot = await readStore()
    const rows = (snapshot.updateSchedules || []).filter((row) => activeStatuses.has(row.status))
    if (!rows.length) return 0
    const developers = await developerIds().catch(() => [])
    let changed = 0
    await mutateStore((store) => {
      for (const row of store.updateSchedules || []) {
        const ms = Date.parse(row.at)
        if (row.status === 'started' || row.status === 'scheduled' && row.version !== version && ms - at <= 15 * MINUTE && at - ms <= LATE_LIMIT_MS) {
          Object.assign(row, { status: 'done', doneAt: new Date(at).toISOString(), versionAfter: version, ...(row.status === 'scheduled' ? { early: true } : {}) })
          changed += 1
        } else if (row.status === 'scheduled' && at - ms > LATE_LIMIT_MS) {
          Object.assign(row, { status: 'expired', expiredAt: new Date(at).toISOString() })
          noticeDevelopers(store, row, 'expired', 'Atualização programada não executada', `O servidor estava fora do ar em ${momentLabel(ms)}. Programe de novo ou atualize pelo SaveInCloud.`, at, developers)
          changed += 1
        }
      }
    })
    return changed
  }

  let sweeping = null
  // Every few seconds: the notice 5 minutes before and, at the hour, the start of the update.
  async function sweep() {
    if (sweeping) return sweeping
    sweeping = (async () => {
      const at = now(), snapshot = await readStore()
      const due = (snapshot.updateSchedules || []).some((row) => row.status === 'scheduled' && (at >= Date.parse(row.at) - WARN_BEFORE_MS && !row.warnedAt || at >= Date.parse(row.at)))
      if (!due) return null
      const developers = await developerIds().catch(() => [])
      const deployment = config()
      let started = null
      await mutateStore((store) => {
        for (const row of store.updateSchedules || []) {
          if (row.status !== 'scheduled') continue
          const ms = Date.parse(row.at)
          if (at - ms > LATE_LIMIT_MS) {
            Object.assign(row, { status: 'expired', expiredAt: new Date(at).toISOString() })
            noticeDevelopers(store, row, 'expired', 'Atualização programada não executada', `O servidor estava fora do ar em ${momentLabel(ms)}. Programe de novo ou atualize pelo SaveInCloud.`, at, developers)
            continue
          }
          if (at >= ms - WARN_BEFORE_MS && !row.warnedAt) {
            row.warnedAt = new Date(at).toISOString()
            if (at < ms) noticeAll(store, row, `warning-${row.history?.length || 0}`, 'Atualização do portal em 5 minutos', `O portal será atualizado às ${hourLabel(ms)} e pode ficar fora do ar por alguns minutos. Salve o que estiver fazendo.`, at)
          }
          if (at >= ms) {
            Object.assign(row, { status: 'started', startedAt: new Date(at).toISOString(), mode: deployment ? 'auto' : 'manual', versionBefore: version })
            if (deployment) started = row.id
            else noticeDevelopers(store, row, 'manual', 'Hora da atualização programada', `Atualize o portal no SaveInCloud (Implementações › ROOT › Atualizar). Depois que o servidor reiniciar, a atualização fica como concluída.`, at, developers)
          }
        }
      })
      if (!started) return null
      log(`Atualização programada: pedindo a atualização do ambiente ${deployment.envName} ao SaveInCloud.`)
      try {
        await deploy(deployment)
        await mutateStore((store) => { const row = (store.updateSchedules || []).find((item) => item.id === started); if (row) row.deployAnswer = 'ok' })
      } catch (error) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
        const reason = timedOut ? 'O SaveInCloud não respondeu em 2 minutos; confira no painel se a atualização está em andamento.' : `O SaveInCloud recusou a atualização: ${clean(error?.message, 300)}.`
        log(`Atualização programada: ${reason}`)
        await mutateStore((store) => {
          const row = (store.updateSchedules || []).find((item) => item.id === started)
          if (!row) return
          row.error = reason
          noticeDevelopers(store, row, 'failed', timedOut ? 'Atualização automática sem resposta' : 'Atualização automática não foi feita', `${reason} Se for preciso, atualize pelo SaveInCloud (Implementações › ROOT › Atualizar).`, now(), developers)
        })
      }
      return started
    })().finally(() => { sweeping = null })
    return sweeping
  }

  async function next() { return nextUpdateView(await readStore()) }

  return { list, create, reschedule, cancel, finish, boot, sweep, next, automatic: () => Boolean(config()) }
}
