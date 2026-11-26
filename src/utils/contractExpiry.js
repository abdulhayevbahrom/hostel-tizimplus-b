import { parsePaymentDate } from './paymentTime.js'

// Both calendar dates are inclusive in Uzbekistan time.
export function contractExpiryRange(query) {
  const from = String(query.contractEndFrom || '')
  const to = String(query.contractEndTo || '')
  if (!from && !to) return {}
  const start = /^\d{4}-\d{2}-\d{2}$/.test(from) ? parsePaymentDate(from) : null
  const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? parsePaymentDate(to) : null
  if (!start || !end || start > end) return null
  return { $gte: start, $lt: new Date(end.getTime() + 86400000) }
}
