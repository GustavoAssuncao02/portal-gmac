import { sharedOperatorKey } from './userActivity.js'

const timeOf = (item) => Math.max(item?.lastAt || 0, item?.since || 0)

export async function developerUsers(accounts, online, userActivity, operatorConfigured) {
  const registered = (await accounts.people()).map(({ id, role, name, email, createdAt }) => ({ key: `${role}:${id}`, id, name, role, email, registeredAt: createdAt }))
  const recent = new Map(online.people.filter((person) => person.role !== 'operator').map((person) => [person.key, person]))
  const history = await userActivity.read([...registered.map((person) => person.key), sharedOperatorKey]).catch(() => null)
  const devices = online.people.filter((person) => person.role === 'operator')
  if (operatorConfigured || devices.length || history?.has(sharedOperatorKey)) registered.push({ key: sharedOperatorKey, name: 'Operador (conta compartilhada)', role: 'operator' })
  const operatorPresence = devices[0] && { ...devices[0], tabs: devices.reduce((total, device) => total + device.tabs, 0), online: devices.some((device) => device.online), outdated: devices.some((device) => device.online && device.outdated) }

  const people = registered.map((profile) => {
    const operator = profile.role === 'operator'
    const presence = operator ? operatorPresence : recent.get(profile.key)
    const usage = history?.get(profile.key)
    const lastSeenAt = Math.max(timeOf(presence), usage?.lastSeenAt || 0) || null
    const connection = presence && (presence.online || timeOf(presence) >= (usage?.lastSeenAt || 0)) ? presence : usage?.lastConnection
    return {
      ...profile,
      online: Boolean(presence?.online), tabs: presence?.tabs || 0, since: presence?.since ?? null,
      lastSeenAt, lastActivityAt: usage?.lastActivityAt ?? null,
      lastLoginAt: usage?.lastLoginAt ?? null, lastLoginActiveMs: usage?.lastLoginActiveMs ?? null,
      usage24hMs: usage?.usage24hMs ?? null, logins24h: usage?.logins24h ?? null,
      device: connection?.device ?? null, version: connection?.version ?? null, build: connection?.build ?? null, ip: connection?.ip ?? null,
      outdated: connection === presence && Boolean(presence?.outdated),
      ...(operator && { devices: devices.map(({ key, tabs, online, since, lastAt, device, version, ip, outdated }) => ({ key, tabs, online, since, lastAt, device, version, ip, outdated })) }),
    }
  })
  people.sort((a, b) => Number(b.online) - Number(a.online) || (b.lastSeenAt || 0) - (a.lastSeenAt || 0) || a.name.localeCompare(b.name, 'pt-BR'))
  return { people, historyAvailable: Boolean(history) }
}
