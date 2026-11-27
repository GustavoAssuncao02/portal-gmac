import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// Trocar de tela desmonta a lista: a ordenação, os filtros, a busca e a página ficam guardados aqui enquanto o navegador estiver
// aberto, inclusive ao recarregar. Ao sair do sistema tudo é apagado, para a próxima pessoa começar do padrão.
const PREFIX = 'gmac-list:'
const storageKey = (screen, field) => `${PREFIX}${screen}:${field}`

export function readListState(screen, field, initial) {
  const fallback = typeof initial === 'function' ? initial() : initial
  try {
    const raw = sessionStorage.getItem(storageKey(screen, field))
    if (raw == null) return fallback
    const saved = JSON.parse(raw)
    // Um filtro novo em uma versão futura vem do padrão, mesmo em uma escolha guardada antes dele.
    return fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? { ...fallback, ...saved } : saved
  } catch { return fallback }
}

export function saveListState(screen, field, value) {
  try { sessionStorage.setItem(storageKey(screen, field), JSON.stringify(value)) } catch { /* sem espaço: a lista só não lembra */ }
}

export function useListState(screen, field, initial) {
  const [value, setValue] = useState(() => readListState(screen, field, initial))
  useEffect(() => { saveListState(screen, field, value) }, [screen, field, value])
  return [value, setValue]
}

export function clearListStates() {
  scrolls.clear()
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(PREFIX)) sessionStorage.removeItem(key)
  } catch { /* nada guardado */ }
}

// Volta para a primeira página só quando o filtro muda de verdade: voltar para a tela não conta como mudança.
export function useResetOnChange(value, reset) {
  const text = JSON.stringify(value), previous = useRef(text)
  useEffect(() => {
    if (previous.current === text) return
    previous.current = text
    reset()
  }, [text])
}

// Onde cada tela estava rolada, enquanto o sistema estiver aberto (recarregar começa do topo): voltar para ela, por exemplo
// do Ver OS para o painel, mostra as mesmas linhas de antes. `key` é a tela (e a oferta ou OS dela). Abrir uma tela em
// outra coisa (outra OS, um filtro vindo do Início) começa do topo de novo: `forgetScroll(tela)`.
const scrolls = new Map()
export function forgetScroll(screen) {
  for (const key of [...scrolls.keys()]) if (key === screen || key.startsWith(`${screen}|`)) scrolls.delete(key)
}

const interruptions = ['wheel', 'touchstart', 'keydown', 'mousedown']
export function useScreenScroll(key) {
  useLayoutEffect(() => {
    if (!key) return undefined
    const target = scrolls.get(key) || 0, started = performance.now()
    let restoring = target > 0, frame = 0
    const finish = () => {
      restoring = false
      cancelAnimationFrame(frame)
      for (const name of interruptions) window.removeEventListener(name, finish, true)
    }
    const reached = () => Math.abs(window.scrollY - target) <= 1
    // A lista ainda pode estar carregando: tenta de novo nos próximos quadros, por até 3 segundos, até a pessoa rolar.
    const step = () => {
      window.scrollTo({ top: target, behavior: 'auto' })
      if (reached() || performance.now() - started > 3000) finish()
      else frame = requestAnimationFrame(step)
    }
    window.scrollTo({ top: target, behavior: 'auto' })
    if (restoring && reached()) finish()
    else if (restoring) {
      for (const name of interruptions) window.addEventListener(name, finish, { capture: true, passive: true })
      frame = requestAnimationFrame(step)
    }
    const record = () => { if (!restoring) scrolls.set(key, window.scrollY) }
    window.addEventListener('scroll', record, { passive: true })
    return () => { finish(); window.removeEventListener('scroll', record) }
  }, [key])
}

// O mesmo que useState; com `screen`, guardado como em useListState, já ao mudar (a tela pode fechar no mesmo clique, como
// ao abrir uma oferta recém-criada). `chosen`: o valor com que a tela foi aberta (um filtro do Início) vale mais que o guardado.
export function useSavedState(screen, field, initial, chosen = null) {
  const [value, setValue] = useState(() => {
    if (chosen != null) { if (screen) saveListState(screen, field, chosen); return chosen }
    return screen ? readListState(screen, field, initial) : typeof initial === 'function' ? initial() : initial
  })
  const update = useCallback((next) => {
    if (typeof next !== 'function') {
      if (screen) saveListState(screen, field, next)
      return setValue(next)
    }
    setValue((current) => { const result = next(current); if (screen) saveListState(screen, field, result); return result })
  }, [screen, field])
  return [value, update]
}
