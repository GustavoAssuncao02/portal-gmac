// Document of the customer of an offer or OS: CNPJ (14 digits) or CPF (11), as the client registry accepts.
export const documentDigits = (value) => String(value ?? '').replace(/\D/g, '')
export const isClientDocument = (value) => [11, 14].includes(documentDigits(value).length)
export const documentKind = (value) => documentDigits(value).length === 11 ? 'CPF' : 'CNPJ'

// Mask while typing: up to 11 digits it is a CPF; from the 12th on, a CNPJ.
export function maskClientDocument(value) {
  const digits = documentDigits(value).slice(0, 14)
  if (digits.length <= 11) return digits.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  return digits.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}
