import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Signature of the e-mails sent from the portal (proposal, measurement of an etiqueta…), drawn from the commercial team's
// model (2026-11-14): logo and "N anos de experiência", the name of who sends it, the role only when that person filled it
// in (Configurações › Dados da conta), and the company's own e-mail, WhatsApp, site, Instagram and map — always the same,
// whoever sends. A proposal issued by GMAC Usinagem carries the Usinagem logo. The images go inside the e-mail (cid), since
// most mail programs block images loaded from the internet or written as data.
const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets')
const FOUNDED = 2008
export const companyContacts = {
  email: 'comercial@gmacmetalurgica.com.br',
  phone: '(75) 3616-6626',
  whatsapp: 'https://wa.me/message/3ZA4QPVIVELAE1',
  site: 'https://gmacmetalurgica.com.br',
  instagram: 'https://www.instagram.com/gmacmetalurgica',
  maps: 'https://www.google.com/maps/place/GMAC+Metal%C3%BArgica/@-12.2958466,-38.9716131,15z/data=!3m1!4b1!4m6!3m5!1s0x714364406f177fb:0xcf4b3099fe5e4621!8m2!3d-12.2958468!4d-38.9613134!16s%2Fg%2F11c5b7dh3k',
}
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const files = {
  icon_email: ['email-signature/icon-email.png', 'image/png'], icon_whatsapp_small: ['email-signature/icon-whatsapp-small.png', 'image/png'],
  icon_site: ['email-signature/icon-site.png', 'image/png'], icon_instagram: ['email-signature/icon-instagram.png', 'image/png'],
  icon_maps: ['email-signature/icon-maps.png', 'image/png'], icon_whatsapp: ['email-signature/icon-whatsapp.png', 'image/png'],
}
const usinagem = (issuer) => issuer?.id === 'usinagem'
const logoFile = (issuer) => usinagem(issuer) ? ['proposal/gmac-usinagem-logo.jpg', 'image/jpeg'] : ['email-signature/logo-metalurgica.png', 'image/png']
const cache = new Map()
const read = (name) => { if (!cache.has(name)) cache.set(name, readFileSync(path.join(assets, name))); return cache.get(name) }
const yearInBahia = (now) => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric' }).format(now))
export const yearsOfExperience = (now = new Date()) => yearInBahia(now) - FOUNDED

// The images, as attachments shown inside the e-mail (`cid`) or, for the preview on the screen, as data.
export function signatureAttachments(issuer) {
  return [['logo', logoFile(issuer)], ...Object.entries(files)].map(([key, [name, contentType]]) => ({ filename: path.basename(name), content: read(name), contentType, cid: `${key}@assinatura.gmac` }))
}
function sources(issuer, mode) {
  return Object.fromEntries(signatureAttachments(issuer).map((file) => [file.cid.split('@')[0], mode === 'data' ? `data:${file.contentType};base64,${file.content.toString('base64')}` : `cid:${file.cid}`]))
}

export function signatureText({ name, jobTitle, issuer, now = new Date() }) {
  return ['Atenciosamente,', '', name || 'Equipe Comercial', ...(jobTitle ? [jobTitle] : []), issuer?.label || 'GMAC Metalúrgica', `${companyContacts.email} · WhatsApp ${companyContacts.phone}`, companyContacts.site.replace('https://', ''), `${yearsOfExperience(now)} anos de experiência`].join('\n')
}

export function signatureHtml({ name, jobTitle, issuer, images = 'cid', now = new Date() }) {
  const src = sources(issuer, images)
  const label = usinagem(issuer) ? 'GMAC Usinagem' : 'GMAC Metalúrgica'
  const icon = (key, alt) => `<img src="${src[key]}" width="15" height="15" alt="${alt}" style="display:inline-block;width:15px;height:15px;border:0;vertical-align:-3px;margin-right:6px;">`
  const social = (href, key, alt, title, margin) => `<a href="${escapeHtml(href)}" title="${title}" style="display:inline-block;${margin};text-decoration:none;"><img src="${src[key]}" width="20" height="20" alt="${alt}" style="display:block;width:20px;height:20px;border:0;"></a>`
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:650px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:#0b376c;">
<tr>
<td style="width:180px;padding:5px 23px 5px 0;vertical-align:middle;border-right:2px solid #f57c16;">
<img src="${src.logo}" width="165" alt="${label}" style="display:block;width:165px;max-width:165px;height:auto;border:0;">
<div style="margin-top:8px;text-align:center;font-family:'Palatino Linotype',Palatino,Georgia,serif;font-size:12.5px;line-height:17px;font-style:italic;font-weight:600;letter-spacing:.45px;color:#0b376c;">${yearsOfExperience(now)} anos de experiência</div>
</td>
<td style="padding:3px 0 3px 23px;vertical-align:middle;">
<div style="font-size:17px;line-height:21px;font-weight:700;letter-spacing:.25px;color:#0b376c;">${escapeHtml(name || 'Equipe Comercial')}</div>
${jobTitle ? `<div style="margin-top:1px;font-size:12px;line-height:17px;font-weight:700;color:#f57c16;">${escapeHtml(jobTitle)}</div>` : ''}
<div style="margin-top:9px;font-size:12px;line-height:18px;color:#46576b;">
${icon('icon_email', 'E-mail')}<a href="mailto:${companyContacts.email}" style="color:#46576b;text-decoration:none;">${companyContacts.email}</a><br>
${icon('icon_whatsapp_small', 'WhatsApp')}<a href="${companyContacts.whatsapp}" style="color:#46576b;text-decoration:none;">${companyContacts.phone}</a>
</div>
<div style="margin-top:9px;line-height:22px;">
${social(companyContacts.site, 'icon_site', 'Site', 'Site da GMAC', 'margin-right:7px')}${social(companyContacts.instagram, 'icon_instagram', 'Instagram', 'Instagram da GMAC', 'margin-right:7px')}${social(companyContacts.maps, 'icon_maps', 'Localização', 'Localização da GMAC', '')}${social(companyContacts.whatsapp, 'icon_whatsapp', 'WhatsApp', 'WhatsApp da GMAC', 'margin-left:7px')}
</div>
</td>
</tr>
</table>`
}
