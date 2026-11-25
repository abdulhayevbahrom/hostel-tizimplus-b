import { parsePaymentDate } from './paymentTime.js'

export function cancelledReportPeriod(value, mode, currentPeriod) {
  const yearly = mode === 'year'
  const period = String(value || (yearly ? currentPeriod.slice(0, 4) : currentPeriod))
  if (!(yearly ? /^[1-9]\d{3}$/ : /^[1-9]\d{3}-(0[1-9]|1[0-2])$/).test(period)) return null
  const year = Number(period.slice(0, 4))
  const month = yearly ? 1 : Number(period.slice(5))
  return { period, mode: yearly ? 'year' : 'month',
    start: parsePaymentDate(`${year}-${String(month).padStart(2, '0')}-01`),
    end: new Date(Date.UTC(yearly ? year + 1 : year, yearly ? 0 : month, 1) - 5 * 3600000) }
}
