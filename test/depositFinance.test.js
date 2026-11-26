import test from 'node:test'
import assert from 'node:assert/strict'
import { cashSessionController } from '../src/controllers/cashSessionController.js'
import { reportController } from '../src/controllers/reportController.js'
import { CashSession } from '../src/models/CashSession.js'
import { Payment } from '../src/models/Payment.js'
import { DepositRefund } from '../src/models/DepositRefund.js'
import { Expense } from '../src/models/Expense.js'
import { SalaryPayment } from '../src/models/SalaryPayment.js'
import { StudentContract } from '../src/models/StudentContract.js'
import { Student } from '../src/models/Student.js'
const query = (value) => ({ sort() { return this }, limit() { return this }, populate() { return this }, select() { return this }, lean() { return Promise.resolve(value) }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject) } })
const response = () => ({ status(code) { this.code = code; return this }, json(body) { this.body = body.data; return this } })

test('central cash deducts active deposit refunds by the actual refund method', async (t) => {
  t.mock.method(CashSession, 'find', () => query([]))
  t.mock.method(Payment, 'aggregate', async () => [{ _id: 'cash', amount: 400000, payments: [] }])
  t.mock.method(DepositRefund, 'aggregate', async (pipeline) => { assert.equal(pipeline[0].$match.status, 'active'); return [{ _id: 'card', amount: 100000 }] })
  const res = response()
  await cashSessionController.list({ employee: { role: 'admin' } }, res, (error) => { throw error })
  assert.equal(res.body.summary.centralCash, 300000)
  assert.equal(res.body.summary.breakdown.cash, 400000)
  assert.equal(res.body.summary.breakdown.card, -100000)
})

for (const view of ['monthly', 'yearly']) test(`${view} report includes active deposit refunds in outgoing cash`, async (t) => {
  t.mock.method(StudentContract, 'distinct', async () => [])
  t.mock.method(Student, 'distinct', async () => [])
  t.mock.method(Payment, 'aggregate', async () => [])
  t.mock.method(Expense, 'aggregate', async () => [])
  t.mock.method(SalaryPayment, 'aggregate', async () => [])
  t.mock.method(reportController, 'details', async () => ({}))
  t.mock.method(DepositRefund, 'aggregate', async (pipeline) => { assert.equal(pipeline[0].$match.status, 'active'); assert.ok(pipeline[0].$match.refundDate.$gte); return [{ _id: view === 'monthly' ? 8 : 11, amount: 100000, count: 1 }] })
  const res = response()
  await (view === 'monthly' ? reportController.getMonthly : reportController.getYearly)({ query: { period: '2026-11', year: '2026' } }, res, (error) => { throw error })
  assert.equal(res.body.summary.outflow, 100000)
  assert.equal(res.body.summary.balance, -100000)
  assert.equal(res.body.rows.find((row) => row.key === (view === 'monthly' ? 8 : 11)).expenses, 100000)
  assert.equal(res.body.categories[0]._id, 'Deposit qaytarish')
})
