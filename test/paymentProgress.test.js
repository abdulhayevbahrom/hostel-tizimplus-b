import test from 'node:test'
import assert from 'node:assert/strict'
import { installmentProgressPeriod, allocatedProgressPayments } from '../src/utils/paymentProgress.js'
import { calculatePaymentProgress, splitDuration } from '../../frontend/src/utils/paymentProgress.js'

const DAY = 86400000
const base = { startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-12-01T00:00:00.000Z', amount: 1200000, paidAmount: 1200000 }
const atDay = (days) => Date.parse(base.startDate) + days * DAY

test('30-day payment earns 400,000 after ten days, with 800,000 and twenty days remaining', () => {
  const row = calculatePaymentProgress(base, atDay(10))
  assert.equal(row.earned, 400000)
  assert.equal(row.remaining, 800000)
  assert.equal(row.remainingTime, 20 * DAY)
  assert.ok(Math.abs(row.percent - 100 / 3) < 1e-9)
})
test('partial payment covers the earliest days instead of discounting the daily rate', () => {
  const row = calculatePaymentProgress({ ...base, paidAmount: 600000 }, atDay(10))
  assert.equal(row.earned, 400000)
  assert.equal(row.remaining, 200000)
  assert.equal(row.remainingTime, 5 * DAY)
  assert.equal(row.coveredUntil, atDay(15))
  assert.equal(calculatePaymentProgress({ ...base, paidAmount: 600000 }, atDay(20)).earned, 600000)
})
test('future stays do not accrue and retain their full paid duration', () => {
  const row = calculatePaymentProgress(base, atDay(-2))
  assert.equal(row.earned, 0)
  assert.equal(row.remaining, 1200000)
  assert.equal(row.remainingTime, 30 * DAY)
  assert.equal(row.startsIn, 2 * DAY)
  assert.equal(row.status, 'upcoming')
})
test('completed stays are capped at the amount actually paid', () => {
  const row = calculatePaymentProgress(base, atDay(40))
  assert.equal(row.earned, 1200000)
  assert.equal(row.remaining, 0)
  assert.equal(row.percent, 100)
  assert.equal(row.remainingTime, 0)
  assert.equal(row.status, 'completed')
})
test('rounding preserves earned plus remaining equals paid', () => {
  const row = calculatePaymentProgress(base, atDay(10) + 1234567)
  assert.equal(row.earned + row.remaining, row.paidAmount)
  assert.ok(Number.isInteger(row.earned))
})
test('daily contracts use their actual interval and seconds accrue correctly', () => {
  const row = calculatePaymentProgress({ ...base, endDate: '2026-11-02T00:00:00Z', amount: 86400, paidAmount: 86400 }, atDay(0) + 1000)
  assert.equal(row.earned, 1)
  assert.equal(row.remainingTime, DAY - 1000)
})
test('monthly periods follow the original contract anchor across February', () => {
  const contract = { startDate: '2028-01-31', endDate: '2028-04-10', paymentType: 'monthly' }
  assert.deepEqual(installmentProgressPeriod({ dueDate: '2028-02-29', periodIndex: 2 }, contract), {
    startDate: '2028-02-29T00:00:00.000Z', endDate: '2028-03-31T00:00:00.000Z',
  })
  assert.equal(installmentProgressPeriod({ dueDate: '2028-03-31', periodIndex: 3 }, contract).endDate, '2028-04-10T00:00:00.000Z')
})
test('daily periods end at the contract boundary and invalid intervals are rejected', () => {
  const contract = { startDate: '2026-11-01', endDate: '2026-11-10', paymentType: 'daily' }
  assert.equal(installmentProgressPeriod({ dueDate: '2026-11-01', periodIndex: 1 }, contract).endDate, '2026-11-10T00:00:00.000Z')
  assert.equal(installmentProgressPeriod({ dueDate: '2026-11-10', periodIndex: 1 }, contract), null)
})
test('allocation totals are specific to each installment', () => {
  const result = allocatedProgressPayments([{ allocations: [{ installment: 'a', amount: 200 }, { installment: 'b', amount: 100 }] }, { allocations: [{ installment: 'a', amount: 300 }] }])
  assert.equal(result.get('a'), 500)
  assert.equal(result.get('b'), 100)
})
test('countdown splits days, hours, minutes and seconds without negative values', () => {
  assert.deepEqual(splitDuration(2 * DAY + 3 * 3600000 + 4 * 60000 + 5000), { days: 2, hours: 3, minutes: 4, seconds: 5 })
  assert.deepEqual(splitDuration(-1), { days: 0, hours: 0, minutes: 0, seconds: 0 })
})

test('student counts are unique across payment periods, with active periods taking priority', async () => {
  const { summarizePaymentProgress } = await import('../../frontend/src/utils/paymentProgress.js')
  const row = { paidAmount: 1200000, earned: 400000, remaining: 800000 }
  const summary = summarizePaymentProgress([
    { ...row, student: { id: 'a' }, status: 'completed' },
    { ...row, student: { id: 'a' }, status: 'active' },
    { ...row, student: { id: 'a' }, status: 'upcoming' },
    { ...row, student: { id: 'b' }, status: 'completed' },
    { ...row, student: { id: 'b' }, status: 'completed' },
    { ...row, student: { id: 'c' }, status: 'upcoming' },
  ])
  assert.equal(summary.studentCount, 3)
  assert.equal(summary.periodCount, 6)
  assert.equal(summary.active, 1)
  assert.equal(summary.completed, 1)
  assert.equal(summary.upcoming, 1)
  assert.equal(summary.paid, 7200000)
  assert.equal(summary.earned, 2400000)
  assert.equal(summary.remaining, 4800000)
})

test('unpaid periods have zero progress and no payment countdown, never a completed status', () => {
  const row = calculatePaymentProgress({ ...base, paidAmount: 0 }, atDay(10))
  assert.equal(row.status, 'unpaid')
  assert.equal(row.earned, 0)
  assert.equal(row.remaining, 0)
  assert.equal(row.percent, 0)
  assert.equal(row.remainingTime, 0)
  assert.equal(calculatePaymentProgress({ ...base, paidAmount: 0 }, atDay(-2)).status, 'unpaid')
})

test('unpaid students are included once in counts without changing collected money totals', async () => {
  const { summarizePaymentProgress } = await import('../../frontend/src/utils/paymentProgress.js')
  const unpaid = { ...calculatePaymentProgress({ ...base, paidAmount: 0 }, atDay(10)), student: { id: 'a' } }
  const summary = summarizePaymentProgress([unpaid, unpaid])
  assert.equal(summary.studentCount, 1)
  assert.equal(summary.unpaid, 1)
  assert.equal(summary.completed, 0)
  assert.equal(summary.paid, 0)
})

test('payment filters classify full, partial and unpaid amounts independently of accrual', () => {
  assert.equal(calculatePaymentProgress(base, atDay(10)).paymentStatus, 'paid')
  const partial = calculatePaymentProgress({ ...base, paidAmount: 700000 }, atDay(25))
  assert.equal(partial.paymentStatus, 'partial')
  assert.equal(partial.status, 'completed')
  assert.equal(calculatePaymentProgress({ ...base, paidAmount: 0 }, atDay(10)).paymentStatus, 'unpaid')
})
