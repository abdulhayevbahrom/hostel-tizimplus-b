import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { depositController } from '../src/controllers/depositController.js'
import { paymentController } from '../src/controllers/paymentController.js'
import { StudentContract } from '../src/models/StudentContract.js'
import { ContractInstallment } from '../src/models/ContractInstallment.js'
import { Payment } from '../src/models/Payment.js'
import { DepositRefund } from '../src/models/DepositRefund.js'
import { Employee } from '../src/models/Employee.js'

const ids = { contract: new mongoose.Types.ObjectId(), student: new mongoose.Types.ObjectId(), installment: new mongoose.Types.ObjectId(), employee: new mongoose.Types.ObjectId(), payment: new mongoose.Types.ObjectId(), refund: new mongoose.Types.ObjectId() }
const query = (value) => ({ session() { return this }, select() { return this }, populate() { return this }, lean() { return Promise.resolve(value) }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject) } })

function setup(t, { paid = 0, refunded = 0, enabled = true, failRefundSave = false } = {}) {
  const session = { withTransaction: async (cb) => cb(), endSession: async () => {} }, events = [], writes = [], locks = []
  const contract = new StudentContract({ _id: ids.contract, student: ids.student, room: new mongoose.Types.ObjectId(), contractNumber: 'TEST', status: 'active', paymentType: 'monthly', depositEnabled: enabled, depositAmount: enabled ? 400000 : 0 })
  t.mock.method(mongoose, 'startSession', async () => session)
  t.mock.method(mongoose.connection, 'transaction', async (cb) => cb(session))
  t.mock.method(StudentContract, 'findById', () => query(contract))
  t.mock.method(StudentContract, 'findOneAndUpdate', async (_filter, change, options) => { assert.equal(options.session, session); assert.equal(change.$inc.depositVersion, 1); locks.push('contract'); return contract })
  t.mock.method(StudentContract.prototype, 'save', async function(options) { assert.equal(options.session, session); writes.push({ type: 'policy', enabled: this.depositEnabled }); return this })
  t.mock.method(Payment, 'aggregate', () => query([{ amount: paid }]))
  t.mock.method(DepositRefund, 'aggregate', () => query([{ amount: refunded }]))
  t.mock.method(ContractInstallment, 'findOne', (filter) => query(String(filter._id) === String(ids.installment) ? { _id: ids.installment, contract: ids.contract, periodKey: '2026-12', amount: 400000, paidAmount: 400000 } : null))
  t.mock.method(Payment, 'create', async ([body], options) => { assert.equal(options.session, session); writes.push(body); return [{ ...body, id: String(ids.payment), populate: async function() { return this } }] })
  t.mock.method(DepositRefund.prototype, 'save', async function(options) { assert.equal(options.session, session); if (failRefundSave) throw new Error('refund write failed'); writes.push(this.toObject()); return this })
  t.mock.method(DepositRefund.prototype, 'populate', async function() { return this })
  const req = { method: 'POST', params: { contractId: String(ids.contract) }, body: {}, employee: { _id: ids.employee, id: String(ids.employee), role: 'admin' }, app: { get: () => ({ emit: (...args) => events.push(args) }) } }
  const call = async (controller, body, method = 'POST', params = {}) => {
    const result = {}
    await controller({ ...req, method, params: { ...req.params, ...params }, body }, { status(code) { result.status = code; return this }, json(body) { result.body = body; return this } }, (error) => { result.error = error })
    return result
  }
  return { session, contract, events, writes, locks, call }
}
const paymentBody = { contract: String(ids.contract), installment: String(ids.installment), paymentPurpose: 'deposit', breakdown: { cash: 200000 }, paymentDate: '2026-11-26T12:00' }
const refundBody = { amount: 100000, method: 'card', refundDate: '2026-11-26T13:00', note: 'Talabaga qaytarildi' }

test('monthly deposit payment records its contract month without paying the rent installment', async (t) => {
  const state = setup(t)
  const result = await state.call(paymentController.create, paymentBody)
  assert.equal(result.status, 201)
  const payment = state.writes[0]
  assert.equal(payment.depositPeriod, '2026-12')
  assert.deepEqual(payment.allocations, [])
  assert.equal(payment.receivedBy, ids.employee)
  assert.equal(payment.amount, 200000)
  assert.equal(state.locks.length, 1)
})

test('disabled deposits, missing months and another contract month cannot be paid', async (t) => {
  const state = setup(t, { enabled: false })
  assert.equal((await state.call(paymentController.create, paymentBody)).status, 400)
  assert.equal((await state.call(paymentController.create, { ...paymentBody, installment: undefined })).status, 400)
  state.contract.depositEnabled = true
  assert.equal((await state.call(paymentController.create, { ...paymentBody, installment: String(new mongoose.Types.ObjectId()) })).status, 400)
  assert.equal(state.writes.length, 0)
})

test('deposit payment refuses stale balance overpayments', async (t) => {
  const state = setup(t, { paid: 300000 })
  const result = await state.call(paymentController.create, paymentBody)
  assert.equal(result.status, 400)
  assert.match(result.body.message, /100.*000/)
  assert.equal(state.writes.length, 0)
})

test('refund stores actor, method, date, amount and audit in the contract transaction', async (t) => {
  const state = setup(t, { paid: 400000 })
  const result = await state.call(depositController.refund, refundBody)
  assert.equal(result.status, 200)
  const refund = state.writes[0]
  assert.equal(String(refund.refundedBy), String(ids.employee))
  assert.equal(String(refund.contract), String(ids.contract))
  assert.equal(refund.method, 'card')
  assert.equal(refund.amount, 100000)
  assert.equal(refund.refundDate.toISOString(), '2026-11-26T08:00:00.000Z')
  assert.equal(refund.auditHistory[0].action, 'created')
  assert.equal(state.locks.length, 1)
})

test('refund cannot exceed remaining held deposit or use an invalid method', async (t) => {
  const state = setup(t, { paid: 400000, refunded: 350000 })
  assert.equal((await state.call(depositController.refund, refundBody)).error.status, 409)
  assert.equal((await state.call(depositController.refund, { ...refundBody, amount: 10000, method: 'invalid' })).error.status, 400)
  assert.equal(state.writes.length, 0)
})

test('a refund save failure never emits success events', async (t) => {
  const state = setup(t, { paid: 400000, failRefundSave: true })
  const result = await state.call(depositController.refund, refundBody)
  assert.match(result.error.message, /refund write failed/)
  assert.equal(state.events.length, 0)
})

test('policy can be cancelled without deleting its receipt or held money', async (t) => {
  const state = setup(t, { paid: 200000 })
  const result = await state.call(depositController.update, {}, 'DELETE')
  assert.equal(result.status, 200)
  assert.equal(state.contract.depositEnabled, false)
  assert.equal(state.contract.depositHistory[0].action, 'cancelled')
  assert.equal(String(state.contract.depositHistory[0].performedBy), String(ids.employee))
  assert.ok(state.contract.depositCancelledAt)
  assert.equal(state.writes.length, 1)
})

test('policy editing cannot reduce the obligation below money already received', async (t) => {
  const state = setup(t, { paid: 300000 })
  const result = await state.call(depositController.update, { depositEnabled: true, depositAmount: 250000 }, 'PUT')
  assert.equal(result.error.status, 409)
  assert.equal(state.writes.length, 0)
})

test('returned money prevents cancelling its source payment', async (t) => {
  const state = setup(t, { paid: 0, refunded: 100000 })
  const payment = { _id: ids.payment, student: ids.student, contract: ids.contract, paymentPurpose: 'deposit', amount: 400000, allocations: [], status: 'active', auditHistory: [] }
  t.mock.method(Payment, 'findById', () => query(payment))
  const result = await state.call(paymentController.remove, {}, 'DELETE', { id: String(ids.payment) })
  assert.equal(result.status, 400)
  assert.match(result.body.message, /qaytarilgan/)
  assert.equal(payment.status, 'active')
})

test('returned money prevents reducing its source payment below the refunded total', async (t) => {
  const state = setup(t, { paid: 0, refunded: 300000 })
  const payment = { _id: ids.payment, student: ids.student, contract: ids.contract, paymentPurpose: 'deposit', depositPeriod: '2026-12', amount: 400000, allocations: [], status: 'active', auditHistory: [] }
  t.mock.method(Payment, 'findById', () => query(payment))
  const result = await state.call(paymentController.update, { ...paymentBody, breakdown: { cash: 200000 } }, 'PUT', { id: String(ids.payment) })
  assert.equal(result.status, 400)
  assert.match(result.body.message, /Qaytarilgan depositdan/)
  assert.equal(payment.amount, 400000)
})

test('refund edits preserve the original payer and record the editor; cancellation restores held money', async (t) => {
  const state = setup(t, { paid: 400000, refunded: 0 })
  const originalActor = new mongoose.Types.ObjectId()
  const refund = new DepositRefund({ _id: ids.refund, student: ids.student, contract: ids.contract, amount: 100000, method: 'cash', refundDate: new Date('2026-11-20'), refundedBy: originalActor, auditHistory: [] })
  t.mock.method(DepositRefund, 'findById', () => query(refund))
  const updated = await state.call(depositController.refund, { ...refundBody, amount: 150000, method: 'bank' }, 'PUT', { id: String(ids.refund) })
  assert.equal(updated.status, 200)
  assert.equal(refund.amount, 150000)
  assert.equal(refund.method, 'bank')
  assert.equal(String(refund.refundedBy), String(originalActor))
  assert.equal(String(refund.auditHistory[0].performedBy), String(ids.employee))
  assert.equal(refund.auditHistory[0].before.amount, 100000)
  const cancelled = await state.call(depositController.refund, {}, 'DELETE', { id: String(ids.refund) })
  assert.equal(cancelled.status, 200)
  assert.equal(refund.status, 'cancelled')
  assert.equal(String(refund.cancelledBy), String(ids.employee))
  assert.equal(refund.auditHistory[1].action, 'cancelled')
  assert.equal((await state.call(depositController.refund, refundBody, 'PUT', { id: String(ids.refund) })).error.status, 409)
})

test('deposit payment editing changes its month without changing rent and keeps audit values', async (t) => {
  const state = setup(t)
  const payment = new Payment({ _id: ids.payment, student: ids.student, contract: ids.contract, paymentPurpose: 'deposit', depositPeriod: '2026-11', amount: 100000, method: 'cash', fundHolder: 'organization', allocations: [], status: 'active', auditHistory: [] })
  t.mock.method(Payment, 'findById', () => query(payment))
  t.mock.method(Payment.prototype, 'save', async function(options) { assert.equal(options.session, state.session); return this })
  t.mock.method(Payment.prototype, 'populate', async function() { return this })
  const result = await state.call(paymentController.update, paymentBody, 'PUT', { id: String(ids.payment) })
  assert.equal(result.status, 200)
  assert.equal(payment.depositPeriod, '2026-12')
  assert.equal(payment.amount, 200000)
  assert.deepEqual(payment.allocations.toObject(), [])
  assert.equal(payment.auditHistory[0].before.paymentPeriod, '2026-11')
  assert.equal(payment.auditHistory[0].after.paymentPeriod, '2026-12')
})
