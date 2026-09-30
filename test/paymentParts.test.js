import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPaymentParts, effectivePaymentParts, paymentFundHolderValue, paymentMethodValue, paymentPartsTotal } from '../src/utils/paymentParts.js'

test('split payment is normalized into one total', () => {
  const parts = buildPaymentParts({ breakdown: { cash: 300000, online: 200000 }, fundHolder: 'organization' }, 'cashier')
  assert.deepEqual(parts, [{ method: 'cash', amount: 300000, fundHolder: 'cashier' }, { method: 'online', amount: 200000, fundHolder: 'organization' }])
  assert.equal(paymentPartsTotal(parts), 500000)
  assert.equal(paymentMethodValue(parts), 'mixed')
  assert.equal(paymentFundHolderValue(parts), 'mixed')
})

test('legacy payment remains a single effective part', () => {
  assert.deepEqual(effectivePaymentParts({ method: 'card', amount: 125000, fundHolder: 'organization' }), [{ method: 'card', amount: 125000, fundHolder: 'organization' }])
})
