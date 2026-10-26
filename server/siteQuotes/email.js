// Monta o e-mail de orçamento (HTML + texto puro) a partir dos campos já validados.
// Layout em tabelas com CSS inline, que é o que Outlook, Gmail e apps de celular renderizam de forma confiável.
// Todo texto vindo do cliente passa por esc() antes de entrar no HTML.

const color = { navy: '#102f46', blue: '#28769e', orange: '#f47a20', ink: '#0b1826', steel: '#edf5f8', muted: '#5b6b78', line: '#dbe5eb' }
const font = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"

const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const digits = (value) => value.replace(/\D/g, '')
const filled = (value) => Boolean(value && value.trim())

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

function formatCnpj(value) {
  const d = digits(value)
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : value
}

function formatDeadline(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
}

function row(label, valueHtml) {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid ${color.line};${font}font-size:13px;color:${color.muted};width:34%;vertical-align:top;">${esc(label)}</td>
    <td style="padding:10px 0;border-bottom:1px solid ${color.line};${font}font-size:15px;color:${color.ink};font-weight:600;vertical-align:top;word-break:break-word;overflow-wrap:anywhere;">${valueHtml}</td>
  </tr>`
}

function section(title, body) {
  return `<tr><td style="padding:24px 28px 0 28px;">
    <div style="${font}font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:${color.blue};font-weight:700;padding-bottom:6px;border-bottom:2px solid ${color.orange};display:inline-block;">${esc(title)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">${body}</table>
  </td></tr>`
}

function textBlock(title, content) {
  return `<tr><td style="padding:24px 28px 0 28px;">
    <div style="${font}font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:${color.blue};font-weight:700;padding-bottom:6px;border-bottom:2px solid ${color.orange};display:inline-block;">${esc(title)}</div>
    <div style="margin-top:12px;padding:14px 16px;background:${color.steel};border-left:4px solid ${color.blue};border-radius:4px;${font}font-size:15px;line-height:1.6;color:${color.ink};white-space:pre-wrap;">${esc(content)}</div>
  </td></tr>`
}

function button(href, label, bg) {
  return `<a href="${esc(href)}" style="display:inline-block;margin:6px 8px 0 0;padding:11px 20px;background:${bg};color:#ffffff;${font}font-size:14px;font-weight:700;text-decoration:none;border-radius:6px;">${esc(label)}</a>`
}

export function buildQuoteEmail(values, files = [], receivedAt = new Date()) {
  const company = values.companyName
  const when = receivedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
  const phoneDigits = digits(values.phone)
  const whatsapp = `https://wa.me/55${phoneDigits}`
  const deadline = filled(values.deadline) ? formatDeadline(values.deadline) : ''

  const contactRows = [
    row('Nome', esc(values.contactName)),
    filled(values.role) ? row('Cargo / função', esc(values.role)) : '',
    row('E-mail', `<a href="mailto:${esc(values.email)}" style="color:${color.blue};text-decoration:none;">${esc(values.email)}</a>`),
    row('Telefone', `<a href="tel:+55${phoneDigits}" style="color:${color.blue};text-decoration:none;">${esc(values.phone)}</a>`),
    row('CNPJ', esc(formatCnpj(values.cnpj))),
  ].join('')

  const orderRows = [
    row('Serviço', esc(values.serviceType)),
    filled(values.material) ? row('Material', esc(values.material)) : '',
    filled(values.quantity) ? row('Quantidade', esc(values.quantity)) : '',
    filled(values.dimensions) ? row('Dimensões', esc(values.dimensions)) : '',
    deadline ? row('Prazo desejado', esc(deadline)) : '',
  ].join('')

  const attachments = files.length
    ? files.map((file) => `<tr><td style="padding:8px 0;border-bottom:1px solid ${color.line};${font}font-size:14px;color:${color.ink};">📎 ${esc(file.name)}</td><td align="right" style="padding:8px 0;border-bottom:1px solid ${color.line};${font}font-size:13px;color:${color.muted};white-space:nowrap;">${esc(formatSize(file.size))}</td></tr>`).join('')
    : `<tr><td style="padding:10px 0;${font}font-size:14px;color:${color.muted};">Nenhum arquivo anexado.</td></tr>`

  const preheader = [values.contactName, values.serviceType, deadline && `prazo ${deadline}`].filter(Boolean).join(' • ')

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orçamento GMAC</title></head>
<body style="margin:0;padding:0;background:#eef2f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f5;"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid ${color.line};">
    <tr><td style="background:${color.navy};padding:26px 28px;">
      <div style="${font}font-size:13px;letter-spacing:3px;color:#6bd6e6;font-weight:700;">GMAC METALÚRGICA</div>
      <div style="${font}font-size:24px;line-height:1.25;color:#ffffff;font-weight:700;margin-top:8px;">Nova solicitação de orçamento</div>
      <div style="${font}font-size:13px;color:#b9cdd9;margin-top:6px;">Recebida pelo site em ${esc(when)}</div>
    </td></tr>
    <tr><td style="height:4px;background:${color.orange};line-height:4px;font-size:0;">&nbsp;</td></tr>
    <tr><td style="padding:24px 28px 0 28px;">
      <div style="${font}font-size:12px;color:${color.muted};text-transform:uppercase;letter-spacing:1px;">Empresa</div>
      <div style="${font}font-size:22px;color:${color.navy};font-weight:700;margin-top:2px;">${esc(company)}</div>
      <div style="margin-top:14px;">
        ${button(`mailto:${values.email}`, 'Responder por e-mail', color.blue)}${button(whatsapp, 'Chamar no WhatsApp', '#1f9d55')}
      </div>
    </td></tr>
    ${section('Contato', contactRows)}
    ${section('Pedido', orderRows)}
    ${textBlock('Descrição', values.description)}
    ${filled(values.notes) ? textBlock('Observações', values.notes) : ''}
    ${section(`Anexos (${files.length})`, attachments)}
    <tr><td style="padding:28px;">
      <div style="padding:14px 16px;background:${color.steel};border-radius:6px;${font}font-size:13px;line-height:1.5;color:${color.muted};">
        Para responder ao cliente, basta clicar em <strong>Responder</strong>: a resposta vai direto para <strong>${esc(values.email)}</strong>.
      </div>
    </td></tr>
  </table>
  <div style="${font}font-size:12px;color:#8a98a3;padding:14px 0;">Mensagem automática do formulário de orçamento do site gmacmetalurgica.com.br</div>
</td></tr></table>
</body></html>`

  const line = (label, value) => (filled(value) ? `${label}: ${value}` : '')
  const text = [
    'NOVA SOLICITAÇÃO DE ORÇAMENTO - GMAC',
    `Recebida pelo site em ${when}`,
    '',
    `EMPRESA: ${company}`,
    '',
    'CONTATO',
    [line('Nome', values.contactName), line('Cargo / função', values.role), line('E-mail', values.email), line('Telefone', values.phone), line('CNPJ', formatCnpj(values.cnpj))].filter(Boolean).join('\n'),
    '',
    'PEDIDO',
    [line('Serviço', values.serviceType), line('Material', values.material), line('Quantidade', values.quantity), line('Dimensões', values.dimensions), line('Prazo desejado', deadline)].filter(Boolean).join('\n'),
    '',
    'DESCRIÇÃO',
    values.description,
    ...(filled(values.notes) ? ['', 'OBSERVAÇÕES', values.notes] : []),
    '',
    `ANEXOS (${files.length})`,
    files.length ? files.map((file) => `- ${file.name} (${formatSize(file.size)})`).join('\n') : 'Nenhum arquivo anexado.',
    '',
    'Para responder ao cliente, use Responder: a resposta vai direto para ' + values.email,
  ].join('\n')

  return { html, text }
}
