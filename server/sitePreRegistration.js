// Pré-cadastro de cliente criado pelo formulário Ofertar Serviço do site: nome e documento, sem e-mail (o e-mail é
// único no banco e poderia colidir com outro cliente). Nada muda na estrutura do banco: o cliente "continua
// pré-cadastro" enquanto o único evento do histórico dele (registryEvents) for a criação pelo Site; quando alguém
// salva o cadastro, accounts.save registra "edited" e a etiqueta some. O descarte da oferta do site usa a mesma regra
// para decidir se apaga o pré-cadastro junto (server/offers.js).
export const SITE_ACTOR = { id: null, name: 'Site' }

// Os clientes que ainda são pré-cadastro: só têm o evento de criação pelo Site no histórico de Cadastros.
export function preRegisteredClientIds(store) {
  const events = new Map()
  for (const event of store.registryEvents || []) {
    if (event.registry !== 'clients') continue
    events.set(event.recordId, (events.get(event.recordId) || []).concat(event))
  }
  const ids = new Set()
  for (const [id, list] of events) {
    if (list.length === 1 && list[0].type === 'created' && list[0].userName === SITE_ACTOR.name) ids.add(id)
  }
  return ids
}

export const isPreRegisteredClient = (store, clientId) => preRegisteredClientIds(store).has(String(clientId))
