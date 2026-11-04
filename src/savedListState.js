import { useEffect, useRef, useState } from 'react'

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
    return fallback && typeof fallback === 'object' ? { ...fallback, ...saved } : saved
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
