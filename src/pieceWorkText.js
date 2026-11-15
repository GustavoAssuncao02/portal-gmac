// "+1 peça - 20 minutos"; several pieces registered at once show the time of each one: "+2 peças - 30 minutos por peça".
const number = (value) => Number(value || 0).toLocaleString('pt-BR')
const workText = (ms) => { const minutes = Math.round(ms / 60000); if (minutes < 1) return 'menos de 1 minuto'; const hours = Math.floor(minutes / 60), rest = minutes % 60, text = `${rest} ${rest === 1 ? 'minuto' : 'minutos'}`; return hours ? `${hours} ${hours === 1 ? 'hora' : 'horas'}${rest ? ` e ${text}` : ''}` : text }
export function piecesText(event, ms) { const quantity = Number(event.quantity) || 0, text = `+${number(quantity)} ${quantity === 1 ? 'peça' : 'peças'}`; return ms ? `${text} - ${workText(quantity > 1 ? ms / quantity : ms)}${quantity > 1 ? ' por peça' : ''}` : text }
