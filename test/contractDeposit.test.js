import test from 'node:test'
import assert from 'node:assert/strict'
import { contractDepositAmount, studentDepositAmount } from '../src/utils/contractDeposit.js'

test('monthly contracts use the configured default deposit', () => {
  assert.equal(contractDepositAmount({ paymentType: 'monthly' }, 500000), 500000)
})

test('daily contracts do not receive an automatic deposit', () => {
  assert.equal(contractDepositAmount({ paymentType: 'daily' }, 500000), 0)
})

test('daily contracts use only their explicitly enabled amount', () => {
  assert.equal(contractDepositAmount({ paymentType: 'daily', depositEnabled: true, depositAmount: 175000 }, 500000), 175000)
})

test('student deposit uses the applicable active contract amount', () => {
  assert.equal(studentDepositAmount([
    { paymentType: 'daily', depositEnabled: false },
    { paymentType: 'daily', depositEnabled: true, depositAmount: 200000 },
  ], 500000), 200000)
})
