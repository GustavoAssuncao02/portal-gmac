// Ofertas com planilha do cliente (2026-11-27, conversa com Nilson): a Nestlé usa sempre a planilha FS-3055 e a Belgo usa
// a planilha da Etiqueta quando a oferta tem Número da etiqueta (sem número, a oferta da Belgo segue o fluxo normal).
// Nessas ofertas as etapas são as linhas de serviço da planilha (cada uma com a máquina ou o serviço do portal que a
// executa) e os materiais são as linhas de material da planilha: o PDF é preenchido pela linha escolhida, sem depender do
// nome digitado. Compartilhado pelo servidor e pelas telas.
export const contractModels = ['nestle', 'etiqueta']
export const contractTitles = { nestle: 'Nestlé · FS-3055', etiqueta: 'Etiqueta Belgo' }
// O complemento do nome da etapa: as duas planilhas têm descrições iguais e o portal acha a etapa da OS pelo nome.
export const contractStageSuffix = { nestle: 'Nestlé', etiqueta: 'Etiqueta' }

const digits = (value) => String(value ?? '').replace(/\D/g, '')
export const nestleDocuments = ['60409075012088', '08334818000152']
export const belgoDocuments = ['61074506000130', '61074506002698', '61074506002507', '61074506000806', '18786988000393']

// A planilha de uma oferta pelos dados dela: o CNPJ (só os dígitos) e o Número da etiqueta.
export function contractModelFor({ cnpj, labelNumber } = {}) {
  const document = digits(cnpj)
  if (nestleDocuments.includes(document)) return 'nestle'
  if (belgoDocuments.includes(document) && String(labelNumber ?? '').trim()) return 'etiqueta'
  return null
}

// A planilha gravada na oferta ou na OS. As ofertas de antes desta regra não têm o campo e seguem o fluxo normal.
export const contractOf = (item) => contractModels.includes(item?.contract) ? item.contract : null

// Código da etapa de uma linha de serviço da planilha.
export const contractStageCode = (model, rowId) => `ct-${model}-${rowId}`

// Unidade de material do portal para a unidade da planilha (KG, Kg, Un., M...).
export function contractMaterialUnit(unit) {
  const text = String(unit ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (/^(kg|quilo|kilo)/.test(text)) return 'kg'
  if (/^(m|metro)s?$/.test(text)) return 'm'
  if (/^(cj|conjunto)/.test(text)) return 'cj'
  return 'un'
}
