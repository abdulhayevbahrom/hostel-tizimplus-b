import assert from 'node:assert/strict'
import test from 'node:test'
import { paymentTimingStatus, periodKeyInTashkent, tashkentDayEnd, tashkentDayStart } from '../src/utils/paymentTime.js'

test('Tashkent month boundary uses local time instead of UTC', () => {
  assert.equal(periodKeyInTashkent('2026-08-31T18:59:59.999Z'), '2026-08')
  assert.equal(periodKeyInTashkent('2026-08-31T19:00:00.000Z'), '2026-09')
})

test('Tashkent day range has exact inclusive UTC boundaries', () => {
  const value = new Date('2026-09-30T10:00:00.000Z')
  assert.equal(tashkentDayStart(value).toISOString(), '2026-09-29T19:00:00.000Z')
  assert.equal(tashkentDayEnd(value).toISOString(), '2026-09-30T18:59:59.999Z')
})

test('payment timing uses 3-day and 5-day grace boundaries', () => {
  const dueDate = '2026-10-01T10:00:00.000Z'
  assert.equal(paymentTimingStatus({ dueDate, completedAt: '2026-10-04T18:59:59.999Z', isPaid: true }), 'onTime')
  assert.equal(paymentTimingStatus({ dueDate, completedAt: '2026-10-05T10:00:00.000Z', isPaid: true }), 'almostOnTime')
  assert.equal(paymentTimingStatus({ dueDate, completedAt: '2026-10-06T18:59:59.999Z', isPaid: true }), 'almostOnTime')
  assert.equal(paymentTimingStatus({ dueDate, completedAt: '2026-10-06T19:00:00.000Z', isPaid: true }), 'late')
})

test('unpaid installment stays pending until the 5-day grace window ends', () => {
  const dueDate = '2026-10-01T10:00:00.000Z'
  assert.equal(paymentTimingStatus({ dueDate, isPaid: false, now: '2026-10-06T10:00:00.000Z' }), 'pending')
  assert.equal(paymentTimingStatus({ dueDate, isPaid: false, now: '2026-10-07T10:00:00.000Z' }), 'late')
})
