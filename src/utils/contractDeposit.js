export const contractDepositAmount = (contract) => {
  if (!contract) return 0
  if (!contract.depositEnabled) return 0
  return Math.max(0, Number(contract.depositAmount || 0))
}

export const studentDepositAmount = (contracts) =>
  (contracts || []).reduce((sum, contract) => sum + contractDepositAmount(contract), 0)

// A refund releases held money; it must not create a new deposit debt.
export function depositState(contract, paid = 0, refunded = 0) {
  const depositAmount = contractDepositAmount(contract)
  const depositHeld = Math.max(0, paid - refunded)
  const depositRemaining = Math.max(0, depositAmount - paid)
  const depositStatus = refunded > 0 ? (depositHeld <= 0 ? 'refunded' : 'partially_refunded')
    : !contract.depositEnabled ? (contract.depositCancelledAt ? 'cancelled' : 'disabled')
      : depositRemaining <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
  return { depositAmount, depositPaid: paid, depositRefunded: refunded, depositHeld, depositRemaining, depositBalance: depositRemaining, depositStatus }
}
