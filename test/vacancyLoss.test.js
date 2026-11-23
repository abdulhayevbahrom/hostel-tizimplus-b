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

test('live loss exposes today separately from selected historical and future months', () => {
  const current = calculate({ period: '2026-11' })
  assert.equal(current.live.todayStart, '2026-11-18T19:00:00.000Z')
  assert.equal(current.live.todayVacantBeds, 1)
  assert.equal(current.live.todayFullLoss, 40000)
  assert.equal(current.live.completedDaysLoss, 18 * 40000)
  assert.equal(current.live.includesToday, true)
  assert.equal(current.live.monthEnd, '2026-11-30T19:00:00.000Z')
  assert.equal(calculate().live.completedDaysLoss, 31 * 40000)
  assert.equal(calculate().live.includesToday, false)
  assert.equal(calculate({ period: '2027-01' }).live.completedDaysLoss, 0)
  const occupiedToday = calculate({ period: '2026-11', contracts: [contract({ endDate: new Date('2026-11-30') })] })
  assert.equal(occupiedToday.live.todayVacantBeds, 0)
  assert.equal(occupiedToday.live.completedDaysLoss, 0)
})

test('daily room and floor losses sum to monthly totals with changing occupancy', () => {
  const result = calculate({ contracts: [contract({ startDate: new Date('2026-10-02T00:00:00+05:00') })] })
  assert.equal(result.daily.length, 31)
  assert.equal(result.daily[0].date, '2026-10-01')
  assert.equal(result.daily[0].rooms[0].capacityBedDays, 1)
  assert.equal(result.daily[0].vacantBedDays, 1)
  assert.equal(result.daily[0].loss, 40000)
  assert.equal(result.daily[1].vacantBedDays, 0)
  assert.equal(result.daily[1].loss, 0)
  assert.equal(result.daily.reduce((sum, day) => sum + day.loss, 0), result.loss)
  for (const day of result.daily) {
    assert.equal(day.rooms.reduce((sum, row) => sum + row.loss, 0), day.loss)
    assert.equal(day.floors.reduce((sum, row) => sum + row.loss, 0), day.loss)
  }
})

test('daily tables exclude future days and rooms before creation or after deletion', () => {
  const result = calculate({ period: '2026-11', rooms: [{ ...room,
    createdAt: new Date('2026-11-02T00:00:00+05:00'),
    isDeleted: true, deletedAt: new Date('2026-11-04T00:00:00+05:00'),
  }] })
  assert.equal(result.daily.length, 19)
  assert.deepEqual(result.daily.slice(0, 4).map((day) => day.rooms.length), [0, 1, 1, 0])
  assert.equal(result.daily.reduce((sum, day) => sum + day.loss, 0), result.loss)
  assert.deepEqual(calculate({ period: '2026-12' }).daily, [])
})

test('calendar slots retain continuing residents and sum to actual daily vacancies', () => {
  const result = calculate({ rooms: [{ ...room, capacity: 4 }], contracts: [
    contract({ student: { _id: 'a' }, endDate: new Date('2026-10-02T23:59:59+05:00') }),
    contract({ student: { _id: 'b' } }),
    contract({ student: { _id: 'c' }, startDate: new Date('2026-10-04T00:00:00+05:00') }),
  ] })
  assert.deepEqual(result.daily[0].rooms[0].bedStates, ['occupied', 'occupied', 'vacant', 'vacant'])
  assert.deepEqual(result.daily[2].rooms[0].bedStates, ['vacant', 'occupied', 'vacant', 'vacant'])
  assert.deepEqual(result.daily[3].rooms[0].bedStates, ['occupied', 'occupied', 'vacant', 'vacant'])
  for (const day of result.daily) {
    const row = day.rooms[0]
    assert.equal(row.bedStates.length, row.capacityBedDays)
    assert.equal(row.bedStates.filter((state) => state === 'vacant').length, row.vacantBedDays)
  }
})

test('one slot retains its 23 empty days after it becomes occupied', () => {
  const result = calculate({ period: '2026-11', todayKey: '2026-12-01',
    contracts: [contract({ startDate: new Date('2026-11-24T00:00:00+05:00'), endDate: new Date('2026-11-30T23:59:59+05:00') })] })
  assert.equal(result.daily.filter((day) => day.rooms[0].bedStates[0] === 'vacant').length, 23)
  assert.equal(result.daily.filter((day) => day.rooms[0].bedStates[0] === 'occupied').length, 7)
  assert.equal(result.vacantBedDays, 23)
  const overcapacity = calculate({ contracts: [contract(), contract({ student: { _id: 's2' } })] })
  assert.deepEqual(overcapacity.daily[0].rooms[0].bedStates, ['occupied'])
})
