import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkSearch, foldSearch } from '../src/workSearch.js'

// The magnifier of Ofertas e serviços, Serviços em andamento and Serviços concluídos (src/workSearch.js).
test('the search finds quote numbers and attachments, of the offer and of its OS, ignoring accents and capitals', () => {
  const offers = [
    { id: 'o1', code: 'OF-2026-0049', service: 'Bucha de bronze TM-23', company: 'A L de Jesus', labelNumber: '', orderCode: 'OS-2026-0010', proposal: { document: { model: 'model-a', quoteNumber: '13483' } }, attachments: [{ id: 'f1', name: 'desenho-bucha.pdf' }], proposalEmails: [{ attachments: [{ id: 'f2', name: 'Catálogo Bronze.pdf' }] }] },
    { id: 'o2', code: 'OF-2026-0050', service: 'Eixo', company: 'Belgo', labelNumber: '4521', proposal: null, attachments: [] },
  ]
  const orders = [
    { code: 'OS-2026-0010', offerId: 'o1', service: 'Bucha de bronze TM-23', company: 'A L de Jesus', attachments: [], purchaseOrders: [{ id: 'f3', name: 'Pão de queijo - pedido 778.pdf' }], proposal: { document: { quoteNumber: '13483' } } },
    { code: 'OS-2026-0011', offerId: 'o3', service: 'Etiqueta', company: 'Belgo', labelNumber: '4600', labelQuote: { versions: [{ number: '4600' }, { number: '13490' }] }, attachments: [{ id: 'f4', name: 'foto.jpg' }], purchaseOrders: [] },
  ]
  const search = createWorkSearch(offers, orders)
  const offersFor = (query) => offers.filter((offer) => search.offer(offer, query)).map((offer) => offer.code)
  const ordersFor = (query) => orders.filter((order) => search.order(order, query)).map((order) => order.code)

  assert.deepEqual(offersFor(''), ['OF-2026-0049', 'OF-2026-0050'], 'an empty search keeps everything')
  assert.deepEqual([offersFor('13483'), ordersFor('13483')], [['OF-2026-0049'], ['OS-2026-0010']], 'the quote number')
  assert.deepEqual(ordersFor('13490'), ['OS-2026-0011'], 'an etiqueta quote number')
  // An administrative attachment of the OS ("pão") finds the OS and its offer.
  assert.deepEqual([offersFor('pao'), ordersFor('PÃO')], [['OF-2026-0049'], ['OS-2026-0010']])
  // An attachment of the offer (also of its proposal e-mail) finds the OS too.
  assert.deepEqual([offersFor('desenho'), ordersFor('desenho')], [['OF-2026-0049'], ['OS-2026-0010']])
  assert.deepEqual(ordersFor('catalogo bronze'), ['OS-2026-0010'])
  assert.deepEqual([offersFor('foto'), ordersFor('foto')], [[], ['OS-2026-0011']])
  assert.deepEqual([offersFor('4521'), offersFor('belgo'), offersFor('os-2026-0010')], [['OF-2026-0050'], ['OF-2026-0050'], ['OF-2026-0049']])
  assert.equal(foldSearch('  Ação  '), 'acao')
})
