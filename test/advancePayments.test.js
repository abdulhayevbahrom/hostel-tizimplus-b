import test from 'node:test'
import assert from 'node:assert/strict'
import { paymentController } from '../src/controllers/paymentController.js'
import { Payment } from '../src/models/Payment.js'
import { StudentContract } from '../src/models/StudentContract.js'

test('advance payments retain the fields needed to edit a fully paid future installment', async (t) => {
  const installment = { id: 'installment-1', periodKey: '2099-12', amount: 500000, paidAmount: 500000 }
  const payment = { id: 'payment-1', student: { id: 'student-1', fullName: 'Test talaba' },
    contract: { id: 'contract-1', contractNumber: 'TEST-1' }, amount: 500000,
    method: 'mixed', fundHolder: 'mixed', paymentPurpose: 'contract', status: 'active',
    allocations: [{ installment, amount: 500000 }],
    paymentParts: [{ method: 'cash', amount: 200000, fundHolder: 'cashier' },
      { method: 'card', amount: 300000, fundHolder: 'organization' }],
    paymentDate: new Date('2026-01-01T07:30:00Z'), note: 'Oldindan to‘lov' }
  t.mock.method(StudentContract, 'distinct', async () => ['contract-1'])
  t.mock.method(Payment, 'find', () => ({ populate() { return this }, sort: async () => [payment] }))
  let response
  await paymentController.advance({}, { status(code) { assert.equal(code, 200); return this },
    json(body) { response = JSON.parse(JSON.stringify(body.data)) } }, (error) => { throw error })
  const saved = response.periods[0].payments[0]
  assert.equal(saved.id, payment.id)
  assert.equal(saved.contract.id, payment.contract.id)
  assert.equal(saved.allocations[0].installment.id, installment.id)
  assert.equal(saved.allocations[0].amount, 500000)
  assert.equal(saved.paymentPurpose, 'contract')
  assert.equal(saved.fundHolder, 'mixed')
  assert.equal(saved.status, 'active')
  assert.deepEqual(saved.paymentParts, payment.paymentParts)
  assert.equal(saved.paymentDate, payment.paymentDate.toISOString())
  assert.equal(saved.note, payment.note)
  assert.equal(response.summary.totalAmount, 500000)
  assert.equal(response.summary.paymentCount, 1)
})
