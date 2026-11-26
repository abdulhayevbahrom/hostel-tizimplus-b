import test from 'node:test'
import assert from 'node:assert/strict'
import { contractDepositAmount, studentDepositAmount, depositState } from '../src/utils/contractDeposit.js'
import { studentContractController } from '../src/controllers/studentContractController.js'
import { planOptionalDeposits } from '../src/services/migrateOptionalDeposits.js'

for (const paymentType of ['monthly', 'daily']) {
  test(`${paymentType} deposit is opt-in and never comes from a changing setting`, () => {
    assert.equal(contractDepositAmount({ paymentType }, 500000), 0)
    assert.equal(contractDepositAmount({ paymentType, depositEnabled: false, depositAmount: 500000 }), 0)
    assert.equal(contractDepositAmount({ paymentType, depositEnabled: true, depositAmount: 175000 }, 500000), 175000)
    const payload = studentContractController.cleanPayload({ paymentType, depositEnabled: true, depositAmount: 175000, startDate: '2026-11-01', endDate: '2026-12-15' })
    assert.equal(payload.depositEnabled, true)
    assert.equal(payload.depositAmount, 175000)
    assert.equal(studentContractController.cleanPayload({ paymentType, depositEnabled: false, depositAmount: 500000 }).depositAmount, 0)
  })
}

test('student deposit sums individual contract obligations without imposing a global amount', () => {
  assert.equal(studentDepositAmount([{ depositEnabled: false }, { depositEnabled: true, depositAmount: 200000 }], 500000), 200000)
})

test('partial and full refunds update held money and status without reopening a deposit debt', () => {
  const contract = { depositEnabled: true, depositAmount: 400000 }
  const partial = depositState(contract, 400000, 150000)
  assert.equal(partial.depositStatus, 'partially_refunded')
  assert.equal(partial.depositHeld, 250000)
  assert.equal(partial.depositRemaining, 0)
  assert.equal(depositState(contract, 400000, 400000).depositStatus, 'refunded')
  assert.equal(depositState({ depositEnabled: false, depositCancelledAt: new Date() }, 400000).depositStatus, 'cancelled')
  assert.equal(depositState({ depositEnabled: false }, 0).depositStatus, 'disabled')
})

test('legacy migration disables unpaid monthly deposits and preserves paid and explicit policies', () => {
  const contracts = [
    { _id: 'unpaid', student: 's1', status: 'active', paymentType: 'monthly' },
    { _id: 'paid', student: 's2', status: 'active', paymentType: 'monthly' },
    { _id: 'new', student: 's3', status: 'active', paymentType: 'monthly', depositPolicyVersion: 1, depositEnabled: true, depositAmount: 900000 },
    { _id: 'daily', student: 's4', status: 'active', paymentType: 'daily', depositEnabled: true, depositAmount: 50000 },
  ]
  const plan = planOptionalDeposits(contracts, [{ _id: 'p1', student: 's2', contract: null, amount: 250000, status: 'active' }, { _id: 'p2', student: 's1', contract: 'unpaid', amount: 400000, status: 'cancelled' }], 400000)
  assert.equal(plan.updates.length, 2)
  assert.deepEqual(plan.updates.map(({ id, depositEnabled, depositAmount }) => ({ id, depositEnabled, depositAmount })), [
    { id: 'unpaid', depositEnabled: false, depositAmount: 0 }, { id: 'paid', depositEnabled: true, depositAmount: 400000 },
  ])
  assert.deepEqual(plan.links, [{ paymentId: 'p1', contractId: 'paid' }])
  const next = contracts.map((contract) => ({ ...contract, ...(plan.updates.find((row) => row.id === contract._id) || {}), depositPolicyVersion: 1 }))
  assert.equal(planOptionalDeposits(next, [], 400000).updates.length, 0, 'reruns never reset an admin choice')
})

test('legacy payment is linked to one contract and a larger paid deposit is never reduced', () => {
  const plan = planOptionalDeposits([
    { _id: 'old', student: 's', status: 'completed', startDate: '2026-08-01', paymentType: 'monthly' },
    { _id: 'current', student: 's', status: 'active', startDate: '2026-11-01', paymentType: 'monthly' },
  ], [{ _id: 'p', student: 's', amount: 600000 }], 400000)
  assert.deepEqual(plan.links, [{ paymentId: 'p', contractId: 'current' }])
  assert.equal(plan.updates.find((row) => row.id === 'current').depositAmount, 600000)
})
