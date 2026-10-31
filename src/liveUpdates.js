// The live connection of this tab (server/liveUpdates.js): the server says which kind of data changed ("notifications",
// "finance" or "data") and the screens that show it update at once (polling.js). One connection per tab, opened while
// some screen listens and the tab is in view: a tab hidden for 30 s closes it (when shown again the screens catch up),
// which also keeps a browser with many tabs under its limit of connections per site. It is read with fetch, so the
// session token travels in the Authorization header, never in the address. A dropped connection comes back by itself,
// and on its return every screen updates once, for what changed in between.
const RETRY_MS = 3000
const REJECTED_RETRY_MS = 30000
const HIDDEN_CLOSE_MS = 30000
// Changing screens stops the listeners of one and starts the next: the connection waits a little before closing.
const IDLE_CLOSE_MS = 2000
// The server sends a sign of life every 25 s: a minute of silence means a connection lost on the way.
const SILENCE_MS = 60000
export const liveTopics = ['notifications', 'finance', 'data']

const listeners = new Set()
let connected = false
let running = false
let controller = null
let hiddenLong = false
let hiddenTimer = null
let idleTimer = null
let stopping = false
let connections = 0

const sessionToken = () => window.sessionStorage.getItem('gmac-admin-token') || window.sessionStorage.getItem('gmac-operator-token')
const sleep = (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms) })
const wanted = () => listeners.size > 0 && !hiddenLong

export const isLiveConnected = () => connected

function dispatch(topics) {
  for (const listener of listeners) if (topics.some((topic) => listener.topics.has(topic))) listener.callback(topics)
}

async function readEvents(body) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', heard = Date.now()
  const watchdog = window.setInterval(() => { if (Date.now() - heard > SILENCE_MS) controller?.abort() }, 15000)
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      heard = Date.now()
      buffer += decoder.decode(value, { stream: true })
      let end
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        // Lines starting with ":" are the signs of life; "data:" carries the kinds of data that changed.
        const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('')
        if (!data) continue
        try { dispatch(JSON.parse(data).topics || []) } catch { /* A message this version does not know: ignored. */ }
      }
    }
  } finally { window.clearInterval(watchdog) }
}

async function connectionLoop() {
  if (running) return
  running = true
  try {
    while (wanted()) {
      const token = sessionToken()
      if (!token) { await sleep(RETRY_MS); continue }
      controller = new AbortController()
      let wait = RETRY_MS
      try {
        const response = await fetch('/api/live', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal })
        if (response.status === 401 || response.status === 403) wait = REJECTED_RETRY_MS
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
        connected = true
        connections += 1
        if (connections > 1) dispatch(liveTopics)
        await readEvents(response.body)
      } catch { /* Closed, dropped or refused: tried again below. */ }
      connected = false
      controller = null
      // Closed on purpose (no screen listening, hidden tab) and wanted again: back at once. Dropped or refused: a pause.
      const onPurpose = stopping
      stopping = false
      if (wanted() && !onPurpose) await sleep(wait)
    }
  } finally { running = false }
}

function stop() {
  if (!controller) return
  stopping = true
  controller.abort()
}

function visibilityChanged() {
  window.clearTimeout(hiddenTimer)
  if (document.visibilityState === 'hidden') {
    hiddenTimer = window.setTimeout(() => { hiddenLong = true; stop() }, HIDDEN_CLOSE_MS)
    return
  }
  if (hiddenLong) { hiddenLong = false; connectionLoop() }
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibilityChanged)

// `callback(topics)` runs when one of `topics` changes. Returns the function that stops listening.
export function subscribeLive(topics, callback) {
  const listener = { topics: new Set(topics), callback }
  listeners.add(listener)
  window.clearTimeout(idleTimer)
  connectionLoop()
  return () => {
    listeners.delete(listener)
    if (listeners.size) return
    window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => { if (!listeners.size) stop() }, IDLE_CLOSE_MS)
  }
}
