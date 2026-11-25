import test from 'node:test'
import assert from 'node:assert/strict'
import { cancelledReportPeriod } from '../src/utils/cancelledReportPeriod.js'
import { studentContractController } from '../src/controllers/studentContractController.js'
import { StudentContract } from '../src/models/StudentContract.js'
import { Student } from '../src/models/Student.js'
import { Payment } from '../src/models/Payment.js'
import { ContractInstallment } from '../src/models/ContractInstallment.js'

test('cancellation report month and year use exclusive Tashkent boundaries', () => {
  const month = cancelledReportPeriod('2026-12', 'month', '2026-11')
  assert.equal(month.start.toISOString(), '2026-11-30T19:00:00.000Z')
  assert.equal(month.end.toISOString(), '2026-12-31T19:00:00.000Z')
  const year = cancelledReportPeriod('2024', 'year', '2026-11')
  assert.equal(year.start.toISOString(), '2023-12-31T19:00:00.000Z')
  assert.equal(year.end.toISOString(), '2024-12-31T19:00:00.000Z')
  assert.equal(cancelledReportPeriod(undefined, 'year', '2026-11').period, '2026')
  assert.equal(cancelledReportPeriod('2026-13', 'month', '2026-11'), null)
  assert.equal(cancelledReportPeriod('2026-11', 'year', '2026-11'), null)
})

test('monthly and annual cancellation summaries select the right contracts and compare each cancellation month', async (t) => {
  const contracts = [
    { _id: 'jan', status: 'cancelled', cancelledAt: new Date('2026-01-01T00:00:00+05:00') },
    { _id: 'dec', status: 'cancelled', cancelledAt: new Date('2026-12-31T23:59:59+05:00') },
    { _id: 'next', status: 'cancelled', cancelledAt: new Date('2027-01-01T00:00:00+05:00') },
    { _id: 'active', status: 'active' },
  ]
  t.mock.method(Student, 'distinct', async () => ['student-1'])
  t.mock.method(StudentContract, 'find', () => ({ select() { return this }, lean: async () => contracts }))
  t.mock.method(StudentContract, 'countDocuments', async () => 0)
  t.mock.method(StudentContract, 'aggregate', async () => [])
  t.mock.method(ContractInstallment, 'aggregate', async () => [])
  let futurePipeline
  t.mock.method(Payment, 'aggregate', async (pipeline) => {
    if (!pipeline.some((stage) => stage.$unwind === '$allocations')) return []
    futurePipeline = pipeline
    return [{ _id: '2027-06', amount: 2500000 }]
  })
  for (const [cancelledView, cancelledPeriod, expected] of [['month', '2026-12', ['dec']], ['year', '2026', ['jan', 'dec']], ['month', '2030-01', []]]) {
    futurePipeline = null
    let response
    await studentContractController.listActive({ query: { cancelledView, cancelledPeriod } }, {
      status(code) { assert.equal(code, 200); return this }, json(body) { response = body.data },
    }, (error) => { throw error })
    assert.equal(response.summary.cancelledReportPeriod, cancelledPeriod)
    assert.equal(response.summary.cancelledFuturePaidAmount, expected.length ? 2500000 : 0)
    if (expected.length) {
      assert.deepEqual(futurePipeline[0].$match.contract.$in, expected)
      assert.equal(futurePipeline[0].$match.status, 'active')
      assert.equal(futurePipeline[0].$match.cancelledAt, null)
      const comparison = futurePipeline.find((stage) => stage.$match?.$expr).$match.$expr.$and[1].$gt[1].$dateToString
      assert.equal(comparison.date, '$cancelledContract.cancelledAt')
      assert.equal(comparison.timezone, 'Asia/Tashkent')
    } else assert.equal(futurePipeline, null)
  }
})
