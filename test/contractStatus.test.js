import assert from 'node:assert/strict'
import test from 'node:test'
import { StudentContract } from '../src/models/StudentContract.js'
import { Notification } from '../src/models/Notification.js'
import { DebtorDeadline } from '../src/models/DebtorDeadline.js'
import { ContractInstallment } from '../src/models/ContractInstallment.js'
import { createContractExpiryNotification, createDebtorDeadlineNotification, scheduleDailyContractSync, syncContractStatuses } from '../src/utils/contractStatus.js'
import { roomBedState } from '../src/utils/roomBeds.js'

test('contracts keep their beds through their final Tashkent day and release them at midnight', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-28T18:59:59.999Z') })
  const room = { capacity: 2, status: 'available', roomNumber: '1' }
  const ending = { _id: 'ending', student: { _id: 'student-1' }, bedNumber: 1,
    status: 'active', startDate: '2026-11-01', endDate: '2026-11-28' }
  const cancelled = { ...ending, _id: 'cancelled', status: 'cancelled', bedNumber: 2,
    cancelledAt: new Date('2026-11-27'), endDate: '2026-12-31' }
  const contracts = [ending, cancelled]
  t.mock.method(StudentContract, 'updateMany', async (filter, update) => {
    let modifiedCount = 0
    for (const contract of contracts) {
      const endDate = new Date(contract.endDate)
      if (contract.status !== filter.status || (filter.endDate.$lt && endDate >= filter.endDate.$lt)
        || (filter.endDate.$gte && endDate < filter.endDate.$gte)
        || (filter.cancelledAt === null && contract.cancelledAt != null)) continue
      Object.assign(contract, update.$set)
      modifiedCount += 1
    }
    return { modifiedCount }
  })
  assert.equal((await syncContractStatuses()).changed, 0)
  assert.equal(ending.status, 'active')
  assert.deepEqual(roomBedState(room, contracts, { startDate: new Date(), endDate: new Date() }).map((bed) => bed.available), [false, true])

  t.mock.timers.setTime(new Date('2026-11-28T19:00:00.000Z').getTime())
  assert.equal((await syncContractStatuses()).changed, 1)
  assert.equal(ending.status, 'completed')
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(ending.bedNumber, 1, 'the original bed number stays in contract history')
  assert.equal(roomBedState(room, contracts, { startDate: new Date(), endDate: new Date() }).every((bed) => bed.available), true)
  assert.equal((await syncContractStatuses()).changed, 0)
})

test('daily sync runs at Tashkent midnight and refreshes live occupancy even without status changes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-28T18:55:00Z') })
  const scheduled = [], events = [], thresholds = []
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { scheduled.push({ callback, delay }) })
  t.mock.method(StudentContract, 'updateMany', async (filter) => {
    thresholds.push(filter.endDate.$lt || filter.endDate.$gte)
    return { modifiedCount: 0 }
  })
  t.mock.method(StudentContract, 'countDocuments', async () => 0)
  t.mock.method(DebtorDeadline, 'find', () => ({ select() { return this }, lean: async () => [] }))
  scheduleDailyContractSync({ emit: (...args) => events.push(args) })
  assert.equal(scheduled[0].delay, 5 * 60 * 1000)
  assert.equal(thresholds.length, 0, 'contracts are not completed five minutes early')

  t.mock.timers.setTime(new Date('2026-11-28T19:00:00Z').getTime())
  await scheduled[0].callback()
  assert.deepEqual(thresholds.map((date) => date.toISOString()), ['2026-11-28T19:00:00.000Z', '2026-11-28T19:00:00.000Z'])
  assert.deepEqual(events.map(([event]) => event), ['student-contracts:changed', 'rooms:changed'])
  assert.equal(scheduled[1].delay, 24 * 60 * 60 * 1000)
})

test('midnight notifications use the same Tashkent date as the contract sync', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-28T19:00:00Z') })
  const keys = [], events = []
  t.mock.method(StudentContract, 'countDocuments', async (filter) => {
    assert.equal(filter.endDate.$gte.toISOString(), '2026-11-28T19:00:00.000Z')
    assert.equal(filter.endDate.$lt.toISOString(), '2026-12-01T19:00:00.000Z')
    return 1
  })
  t.mock.method(DebtorDeadline, 'find', (filter) => {
    assert.equal(filter.deadline.$gte.toISOString(), '2026-11-28T19:00:00.000Z')
    assert.equal(filter.deadline.$lt.toISOString(), '2026-11-29T19:00:00.000Z')
    return { select() { return this }, lean: async () => [{ student: 'student-1', periodKey: '2026-11' }] }
  })
  t.mock.method(StudentContract, 'distinct', async () => ['contract-1'])
  t.mock.method(ContractInstallment, 'exists', async () => true)
  t.mock.method(Notification, 'updateOne', async (filter) => { keys.push(filter.eventKey); return { upsertedCount: 1 } })
  const io = { emit: (...args) => events.push(args) }
  await createContractExpiryNotification(io)
  await createDebtorDeadlineNotification(io)
  assert.deepEqual(keys, ['contract-expiry:2026-11-29', 'debtor-deadline:2026-11-29'])
  assert.equal(events.length, 2)
})
