import { StudentContract } from '../models/StudentContract.js'
import { Payment } from '../models/Payment.js'
import { DepositRefund } from '../models/DepositRefund.js'
import { ContractInstallment } from '../models/ContractInstallment.js'
import { depositState } from '../utils/contractDeposit.js'
import mongoose from 'mongoose'

export const depositError = (message, status = 409) => Object.assign(new Error(message), { status, paymentValidation: true })

// Every deposit mutation writes this same document before reading the ledger.
// Concurrent payments, refunds and policy edits retry against the latest balance.
export async function lockDeposit(contractId, session) {
  const contract = await StudentContract.findOneAndUpdate({ _id: contractId }, { $inc: { depositVersion: 1 } }, { new: true, session })
  if (!contract) throw depositError('Shartnoma topilmadi', 404)
  return contract
}

export async function depositTotals(contractId, session = null, { excludePayment = null, excludeRefund = null } = {}) {
  const paidRows = await Payment.aggregate([{ $match: { contract: contractId, paymentPurpose: 'deposit', status: { $ne: 'cancelled' }, cancelledAt: null,
    ...(excludePayment ? { _id: { $ne: excludePayment } } : {}) } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]).session(session)
  const refundRows = await DepositRefund.aggregate([{ $match: { contract: contractId, status: 'active',
    ...(excludeRefund ? { _id: { $ne: excludeRefund } } : {}) } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]).session(session)
  return { paid: Number(paidRows[0]?.amount || 0), refunded: Number(refundRows[0]?.amount || 0) }
}

export async function depositPeriod(contractId, installmentId, session) {
  if (!mongoose.isValidObjectId(installmentId)) throw depositError('Deposit uchun shartnoma ichidagi oyni tanlang', 400)
  const installment = await ContractInstallment.findOne({ _id: installmentId, contract: contractId }).session(session)
  if (!installment) throw depositError('Deposit uchun shartnoma ichidagi oyni tanlang', 400)
  return installment.periodKey
}

export async function validateDepositPolicy(contract, enabled, amount, session) {
  if (enabled && (!Number.isSafeInteger(amount) || amount <= 0)) throw depositError('Deposit summasi 0 dan katta butun son bo‘lishi kerak', 400)
  const { paid } = await depositTotals(contract._id, session)
  if (enabled && amount < paid) throw depositError(`Deposit summasi to‘langan ${paid.toLocaleString('uz-UZ')} so‘mdan kam bo‘lmasligi kerak`)
}

export function applyDepositPolicy(contract, enabled, amount, employeeId, note = '') {
  const before = { enabled: Boolean(contract.depositEnabled), amount: Number(contract.depositAmount || 0) }
  const after = { enabled, amount: enabled ? amount : 0 }
  if (before.enabled === after.enabled && before.amount === after.amount) return
  contract.depositHistory ||= []
  contract.depositHistory.push({ action: enabled ? 'updated' : 'cancelled', performedBy: employeeId, before, after, note })
  contract.depositEnabled = enabled
  contract.depositAmount = after.amount
  contract.depositCancelledAt = enabled ? null : new Date()
}

export async function depositStates(contracts, session = null) {
  const ids = contracts.map((contract) => contract._id)
  const [payments, refunds] = await Promise.all([
    Payment.aggregate([{ $match: { contract: { $in: ids }, paymentPurpose: 'deposit', status: { $ne: 'cancelled' }, cancelledAt: null } },
      { $group: { _id: '$contract', paid: { $sum: '$amount' }, lastPaidAt: { $max: '$paymentDate' } } }]).session(session),
    DepositRefund.aggregate([{ $match: { contract: { $in: ids }, status: 'active' } }, { $group: { _id: '$contract', refunded: { $sum: '$amount' } } }]).session(session),
  ])
  const paidMap = new Map(payments.map((item) => [String(item._id), item]))
  const refundMap = new Map(refunds.map((item) => [String(item._id), item.refunded]))
  return new Map(contracts.map((contract) => {
    const key = String(contract._id)
    return [key, { ...depositState(contract, Number(paidMap.get(key)?.paid || 0), Number(refundMap.get(key) || 0)), lastPaidAt: paidMap.get(key)?.lastPaidAt || null }]
  }))
}
