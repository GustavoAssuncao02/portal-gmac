// Shared by the API and the browser: an OS may have several employees working at the same time.
// Older records stored a single `activeSession`; they are read as a list with one item.

export function activeSessions(operation) {
  if (Array.isArray(operation?.activeSessions)) return operation.activeSessions
  return operation?.activeSession ? [operation.activeSession] : []
}

// Start of the current uninterrupted period with at least one employee working.
export function activeSince(operation) {
  const sessions = activeSessions(operation)
  if (!sessions.length) return null
  if (operation.activeSince) return operation.activeSince
  const starts = sessions.map((session) => Date.parse(session.startedAt)).filter(Number.isFinite)
  return starts.length ? new Date(Math.min(...starts)).toISOString() : null
}

// Project time counts the periods with someone working once, even with several employees together.
export function operationElapsed(operation, now = Date.now()) {
  const since = Date.parse(activeSince(operation))
  return Number(operation?.accumulatedMs || 0) + (Number.isFinite(since) ? Math.max(0, now - since) : 0)
}

export function activeEmployeeNames(operation) {
  return [...new Set(activeSessions(operation).map((session) => session.employeeName).filter(Boolean))].join(', ')
}

export function sessionResourceName(session) {
  return session?.machineName || session?.laborServiceName || ''
}
