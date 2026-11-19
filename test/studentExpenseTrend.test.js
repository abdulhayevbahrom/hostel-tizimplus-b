import assert from 'node:assert/strict'
import test from 'node:test'
import { studentExpenseTrend, yearlyStudentCounts } from '../src/utils/studentExpenseTrend.js'

test('cost follows accumulated expenses and distinct residents on each day', () => {
  const contract = (id, startDate, extra = {}) => ({
    student: { _id: id },
    startDate: new Date(startDate),
    endDate: new Date('2026-11-30'),
    status: 'active',
    ...extra,
  })
  const summary = studentExpenseTrend({
    period: '2026-11',
    days: 5,
    expenses: new Map([[1, 100], [4, 200]]),
    contracts: [
      contract('a', '2026-11-02'),
      contract('a', '2026-11-02'),
      contract('b', '2026-11-03', { status: 'cancelled', cancelledAt: new Date('2026-11-04T19:00:00Z') }),
    ],
  })
  assert.deepEqual(summary.rows.map(({ studentCount }) => studentCount), [0, 1, 2, 2, 1])
  assert.deepEqual(summary.rows.map(({ cost }) => cost), [null, 100, 50, 150, 300])
  assert.equal(summary.average, 150)
})

test('yearly resident counts use month end, with today for an unfinished month', () => {
  const contracts = [
    { student: { _id: 'a' }, startDate: new Date('2026-01-01'), endDate: new Date('2026-02-05'), status: 'completed' },
    { student: { _id: 'b' }, startDate: new Date('2026-02-03'), endDate: new Date('2026-02-28'), status: 'active' },
  ]
  assert.deepEqual(yearlyStudentCounts(2026, '2026-02-04', contracts), [
    { month: 1, studentCount: 1 },
    { month: 2, studentCount: 2 },
  ])
  assert.equal(yearlyStudentCounts(2026, '2027-01-01', contracts)[1].studentCount, 1)
  assert.equal(yearlyStudentCounts(2026, '2027-01-01', contracts).length, 12)
  assert.deepEqual(yearlyStudentCounts(2027, '2026-02-04', contracts), [])
})
