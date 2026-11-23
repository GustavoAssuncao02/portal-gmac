import assert from 'node:assert/strict'
import test from 'node:test'
import { commentMail, replyMail, ticketMail } from '../server/supportTickets.js'

// The ticket e-mails are read first on the phone, where only the subject and the start of the text show (2026-11-23):
// what happened and the urgency come first, then the subject of the ticket; in a reply, the reply itself, then who wrote.
const ticket = { id: 'TCK-0003', urgency: 'medium', module: 'other', title: 'Mensagem "criando oferta" <ainda>', description: 'Descrição', createdByName: 'MARIA TESTE', createdAt: '2026-11-23T11:56:00Z', attachments: [{ name: 'ticket.png' }] }
const comment = { userName: 'MARIA TESTE', at: '2026-11-23T14:46:00Z', text: 'Sim, eu sempre deixo essa opção selecionada.' }

test('ticket e-mails start with the kind, the urgency and the subject of the ticket', () => {
  const opened = ticketMail(ticket, ['a@example.invalid', 'b@example.invalid'])
  assert.equal(opened.to, 'a@example.invalid, b@example.invalid')
  assert.equal(opened.subject, 'Novo ticket · 🟠 Urgência média · TCK-0003 · Mensagem "criando oferta" <ainda>')
  assert.equal(opened.text.split('\n')[0], 'Mensagem "criando oferta" <ainda> · Outro · aberto por MARIA TESTE')
  assert.match(opened.text, /Anexos: 1 anexo: ticket\.png/)

  const reply = replyMail(ticket, comment, ['a@example.invalid'])
  assert.equal(reply.subject, 'Resposta · 🟠 Urgência média · TCK-0003 · Mensagem "criando oferta" <ainda>')
  assert.equal(reply.text.split('\n')[0], 'Mensagem "criando oferta" <ainda> · MARIA TESTE respondeu: “Sim, eu sempre deixo essa opção selecionada.”')

  const support = commentMail({ ...ticket, urgency: 'high' }, { ...comment, userName: 'GUSTAVO', text: 'x'.repeat(300) }, { name: 'MARIA TESTE', email: 'maria@example.invalid' })
  assert.equal(support.to, 'maria@example.invalid')
  assert.match(support.subject, /^Resposta do suporte · TCK-0003 · /)
  assert.ok(support.text.split('\n')[0].length < 260, 'a long comment is shortened in the first line')
  assert.match(support.html, /RESPOSTA DO SUPORTE[\s\S]*🔴 Urgência alta/)

  // What people typed never becomes HTML.
  for (const mail of [opened, reply, support]) assert.ok(!mail.html.includes('<ainda>') && mail.html.includes('&lt;ainda&gt;'))
})
