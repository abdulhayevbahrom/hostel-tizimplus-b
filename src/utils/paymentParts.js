export const PAYMENT_METHODS = ['cash', 'card', 'bank', 'online']

export const effectivePaymentParts = (payment) => payment.paymentParts?.length
  ? payment.paymentParts.map((part) => ({ method: part.method, amount: Number(part.amount), fundHolder: part.fundHolder }))
  : [{ method: payment.method, amount: Number(payment.amount), fundHolder: payment.fundHolder || 'organization' }]

export const buildPaymentParts = (body, receiverRole) => {
  const hasBreakdown = body.breakdown && typeof body.breakdown === 'object'
  const rawBreakdown = hasBreakdown ? PAYMENT_METHODS.map((method) => ({ method, amount: Number(body.breakdown[method] || 0) })) : []
  if (rawBreakdown.some((part) => !Number.isSafeInteger(part.amount) || part.amount < 0)) throw Object.assign(new Error('To‘lov summalarini to‘g‘ri kiriting'), { paymentValidation: true })
  const requested = hasBreakdown
    ? rawBreakdown.filter((part) => part.amount > 0)
    : [{ method: body.method, amount: Number(body.amount) }]
  if (!requested.length || requested.some((part) => !PAYMENT_METHODS.includes(part.method) || !Number.isSafeInteger(part.amount) || part.amount <= 0)) throw Object.assign(new Error('To‘lov summalarini to‘g‘ri kiriting'), { paymentValidation: true })
  const optionalHolder = ['cashier', 'organization'].includes(body.fundHolder) ? body.fundHolder : null
  return requested.map((part) => ({
    ...part,
    fundHolder: receiverRole !== 'cashier' ? 'organization' : part.method === 'cash' ? 'cashier' : part.method === 'bank' ? 'organization' : optionalHolder || 'organization',
  }))
}

export const paymentPartsTotal = (parts) => parts.reduce((sum, part) => sum + part.amount, 0)
export const paymentMethodValue = (parts) => parts.length === 1 ? parts[0].method : 'mixed'
export const paymentFundHolderValue = (parts) => new Set(parts.map((part) => part.fundHolder)).size === 1 ? parts[0].fundHolder : 'mixed'

// Aggregation stages that expose one row per method while keeping legacy
// payments (which only have method/amount) fully compatible.
export const unwindPaymentParts = [
  { $set: { _effectivePaymentParts: { $cond: [{ $gt: [{ $size: { $ifNull: ['$paymentParts', []] } }, 0] }, '$paymentParts', [{ method: '$method', amount: '$amount', fundHolder: { $ifNull: ['$fundHolder', { $cond: [{ $ne: ['$cashSession', null] }, 'cashier', 'organization'] }] } }]] } } },
  { $unwind: '$_effectivePaymentParts' },
]
