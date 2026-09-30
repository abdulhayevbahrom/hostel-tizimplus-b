import assert from 'node:assert/strict'
import test from 'node:test'
import { periodKeyInTashkent, tashkentDayEnd, tashkentDayStart } from '../src/utils/paymentTime.js'

test('Tashkent month boundary uses local time instead of UTC', () => {
  assert.equal(periodKeyInTashkent('2026-08-31T18:59:59.999Z'), '2026-08')
  assert.equal(periodKeyInTashkent('2026-08-31T19:00:00.000Z'), '2026-09')
})

test('Tashkent day range has exact inclusive UTC boundaries', () => {
  const value = new Date('2026-09-30T10:00:00.000Z')
  assert.equal(tashkentDayStart(value).toISOString(), '2026-09-29T19:00:00.000Z')
  assert.equal(tashkentDayEnd(value).toISOString(), '2026-09-30T18:59:59.999Z')
})
