export const contractDepositAmount = (contract, defaultAmount = 0) => {
  if (!contract) return 0
  if (contract.paymentType !== 'daily') return Math.max(0, Number(defaultAmount || 0))
  if (!contract.depositEnabled) return 0
  return Math.max(0, Number(contract.depositAmount || 0))
}

export const studentDepositAmount = (contracts, defaultAmount = 0) =>
  Math.max(0, ...(contracts || []).map((contract) => contractDepositAmount(contract, defaultAmount)))
