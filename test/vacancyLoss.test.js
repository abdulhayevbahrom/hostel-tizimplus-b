import test from 'node:test'
import assert from 'node:assert/strict'
import { vacancyLoss } from '../src/utils/vacancyLoss.js'

const room = { _id: 'r1', roomNumber: '101', block: 'A', floor: '1', capacity: 1, status: 'available' }
const contract = (extra = {}) => ({ room: 'r1', student: { _id: 's1' }, startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31'), status: 'completed', ...extra })
const calculate = (extra = {}) => vacancyLoss({ period: '2026-10', todayKey: '2026-11-19', dailyRate: 40000, rooms: [room], contracts: [], ...extra })

test('30 empty bed-days at 40000 cost 1200000, with room and floor totals', () => {
  const result = calculate({ rooms: [{ ...room, createdAt: new Date('2026-10-02T00:00:00+05:00') }] })
  assert.equal(result.vacantBedDays, 30)
  assert.equal(result.loss, 1200000)
  assert.equal(result.rooms[0].loss, result.loss)
  assert.equal(result.floors[0].loss, result.loss)
  assert.equal(result.months[9].loss, result.loss)
})

test('counts daily occupancy, deduplicates students and clamps overcapacity', () => {
  const result = calculate({ contracts: [contract({ startDate: new Date('2026-10-02T00:00:00+05:00') }), contract({ startDate: new Date('2026-10-02T00:00:00+05:00') })] })
  assert.equal(result.vacantBedDays, 1)
  assert.equal(calculate({ contracts: [contract(), contract({ student: { _id: 's2' } })] }).loss, 0)
})

test('preserves occupancy before cancellation and soft deletion', () => {
  for (const extra of [
    { status: 'cancelled', cancelledAt: new Date('2026-10-03T00:00:00+05:00') },
    { isDeleted: true, deletedAt: new Date('2026-10-03T00:00:00+05:00') },
    { student: { _id: 's1', isDeleted: true, deletedAt: new Date('2026-10-03T00:00:00+05:00') } },
  ]) assert.equal(calculate({ contracts: [contract(extra)] }).vacantBedDays, 29)
})

test('caps the current month at today and excludes future months', () => {
  const result = calculate({ period: '2026-11' })
  assert.equal(result.days, 19)
  assert.equal(result.vacantBedDays, 19)
  assert.equal(result.months[11].loss, 0)
  assert.equal(calculate({ period: '2027-01' }).yearLoss, 0)
})

test('separates blocks with the same floor and excludes maintenance rooms', () => {
  const result = calculate({ rooms: [room, { ...room, _id: 'r2', block: 'B' }, { ...room, _id: 'r3', status: 'maintenance' }] })
  assert.equal(result.floors.length, 2)
  assert.equal(result.vacantBedDays, 62)
  assert.equal(result.floors.reduce((sum, floor) => sum + floor.loss, 0), result.loss)
})

test('handles leap years, deleted rooms and missing rate', () => {
  assert.equal(calculate({ period: '2024-02' }).vacantBedDays, 29)
  assert.equal(calculate({ rooms: [{ ...room, isDeleted: true, deletedAt: new Date('2026-10-03T00:00:00+05:00') }] }).vacantBedDays, 2)
  assert.equal(calculate({ dailyRate: undefined }).loss, 0)
})
