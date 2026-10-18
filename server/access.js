import { adminIdentity, requireAdmin } from './accounts.js'
import { requireOperator } from './operatorAuth.js'

// Production data used both by the administrative portal and by the shared operator account (the OS files, its history,
// the machines and labor services to choose from): an administrator session or the operator session is accepted.
export function requireAdminOrOperator(request, response, next) {
  return adminIdentity(request) ? requireAdmin(request, response, next) : requireOperator(request, response, next)
}
