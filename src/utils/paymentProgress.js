// Installments use UTC calendar dates throughout contract billing.
const addMonths = (value, months) => {
  const date = new Date(value)
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(date.getUTCDate(), lastDay))
  return result
}

export function installmentProgressPeriod(installment, contract) {
  const start = new Date(installment.dueDate)
  const next = contract.paymentType === 'daily'
    ? new Date(contract.endDate)
    : addMonths(contract.startDate, Number(installment.periodIndex))
  const end = new Date(Math.min(next.getTime(), new Date(contract.endDate).getTime()))
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null
  return { startDate: start.toISOString(), endDate: end.toISOString() }
}

export function allocatedProgressPayments(payments) {
  const amounts = new Map()
  for (const payment of payments) {
    for (const allocation of payment.allocations || []) {
      const id = String(allocation.installment)
      amounts.set(id, (amounts.get(id) || 0) + Math.max(0, Number(allocation.amount) || 0))
    }
  }
  return amounts
}
