import assert from 'node:assert/strict'
import test from 'node:test'
import { createContractInitialValues } from '../../frontend/src/utils/contractForm.js'
import { calculateContractPayment as previewPayment } from '../../frontend/src/utils/contractPayment.js'
import { calculateContractPayment } from '../src/utils/contractPayment.js'

test('the default one-month stay has no timestamp drift and its preview agrees with the saved billing quantity', () => {
  const values = createContractInitialValues()
  const preview = previewPayment(values.startDate, values.endDate, 'monthly', 400000)
  const saved = calculateContractPayment(values.startDate.format('YYYY-MM-DD'), values.endDate.format('YYYY-MM-DD'), 'monthly', 400000)
  assert.equal(preview.billingQuantity, 1)
  assert.equal(preview.totalAmount, saved.totalAmount)
  assert.equal(values.startDate.hour(), 0)
  assert.equal(values.endDate.hour(), 0)
  assert.equal(values.bedNumber, undefined)
})
