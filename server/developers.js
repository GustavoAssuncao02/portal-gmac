// The developers of the portal: the accounts of these CPFs close and reopen tickets (Ticket) and open the Desenvolvedor
// screen (logs, online users, system data). An account registered later with one of them becomes a developer without any
// change here. Always checked by the server; the menu only hides the item. Shared by the server and the screens.
export const developerCpfs = ['02427847550', '14303355640']
const digits = (value) => String(value ?? '').replace(/\D/g, '')
export const isDeveloper = (account, cpfs = developerCpfs) => Boolean(account?.cpf) && cpfs.includes(digits(account.cpf))
