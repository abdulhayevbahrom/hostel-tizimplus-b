import mongoose from 'mongoose'
import { StudentContract } from '../models/StudentContract.js'
import { Payment } from '../models/Payment.js'
import { GeneralSetting } from '../models/GeneralSetting.js'

export function planOptionalDeposits(contracts, payments, defaultAmount) {
  const byId = new Map(contracts.map((contract) => [String(contract._id), contract]))
  const byStudent = new Map()
  for (const contract of contracts) {
    const key = String(contract.student)
    if (!byStudent.has(key)) byStudent.set(key, [])
    byStudent.get(key).push(contract)
  }
  for (const rows of byStudent.values()) rows.sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || new Date(b.startDate) - new Date(a.startDate))
  const paid = new Map(), links = []
  for (const payment of payments) {
    // Keep existing links. Only old student-level deposit receipts need a home.
    const contract = payment.contract ? byId.get(String(payment.contract)) : byStudent.get(String(payment.student))?.[0]
    if (!contract) continue
    const key = String(contract._id)
    if (!payment.contract) links.push({ paymentId: payment._id, contractId: contract._id })
    if (payment.status !== 'cancelled' && !payment.cancelledAt) paid.set(key, (paid.get(key) || 0) + Number(payment.amount || 0))
  }
  const updates = contracts.filter((contract) => contract.paymentType !== 'daily' && contract.depositPolicyVersion !== 1).map((contract) => {
    const amountPaid = paid.get(String(contract._id)) || 0
    return { id: contract._id, before: { enabled: contract.depositEnabled, amount: contract.depositAmount },
      depositEnabled: amountPaid > 0, depositAmount: amountPaid > 0 ? Math.max(amountPaid, Number(defaultAmount || 0)) : 0 }
  })
  return { updates, links }
}

export async function migrateOptionalDeposits({ dryRun = true } = {}) {
  const run = async (session = null) => {
    const contracts = await StudentContract.find().session(session).lean()
    const payments = await Payment.find({ paymentPurpose: 'deposit' }).session(session).lean()
    const settings = await GeneralSetting.findOne({ key: 'general' }).session(session).lean()
    const plan = planOptionalDeposits(contracts, payments, settings?.depositAmount)
    if (!dryRun) {
      // The policy version makes reruns leave every administrator's later edits intact.
      for (const update of plan.updates) await StudentContract.updateOne({ _id: update.id, depositPolicyVersion: { $ne: 1 } }, { $set: { depositEnabled: update.depositEnabled, depositAmount: update.depositAmount, depositPolicyVersion: 1 } }, { session, timestamps: false })
      for (const link of plan.links) await Payment.updateOne({ _id: link.paymentId, contract: null }, { $set: { contract: link.contractId } }, { session, timestamps: false })
    }
    return { dryRun, disabled: plan.updates.filter((row) => !row.depositEnabled).length, preservedPaid: plan.updates.filter((row) => row.depositEnabled).length, linkedLegacyPayments: plan.links.length }
  }
  return dryRun ? run() : mongoose.connection.transaction((session) => run(session))
}
