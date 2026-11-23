import test from 'node:test'
import assert from 'node:assert/strict'
import { vacancyLoss } from '../src/utils/vacancyLoss.js'
import { vacancyCalendar } from '../../frontend/src/utils/vacancyCalendar.js'

const room = { _id: 'r17', roomNumber: '17', block: 'A', floor: '1', capacity: 4, status: 'available' }
const contract = (student, start, end) => ({ room: 'r17', student: { _id: student },
  startDate: new Date(`2026-11-${start}T00:00:00+05:00`), endDate: new Date(`2026-11-${end}T23:59:59+05:00`), status: 'active' })
// Four occupancy histories: empty for 23, 10, 3, and 4 days respectively.
const contracts = [contract('s1', '24', '30'), contract('s2', '01', '20'),
  contract('s3', '01', '04'), contract('s3', '08', '30'),
  contract('s4', '01', '11'), contract('s4', '16', '30')]
const calculate = (extra = {}) => vacancyLoss({ period: '2026-11', todayKey: '2026-11-23', dailyRate: 0, rooms: [room], contracts, ...extra })

test('distinguishes vacant bed-days, days with vacancies and the latest snapshot without a price', () => {
  const [report] = vacancyCalendar(calculate())
  assert.equal(report.vacantBedDays, 33)
  assert.equal(report.vacancyDays, 23)
  assert.equal(report.maxVacant, 2)
  assert.equal(report.lastDay.vacant, 2)
  assert.equal(report.days.length, 23)
  assert.equal(report.days.reduce((sum, day) => sum + day.vacant, 0), report.vacantBedDays)
  assert.equal(report.loss, 0)
})

test('later occupation preserves the earlier 23 vacancy days and counts all four histories', () => {
  const [report] = vacancyCalendar(calculate({ todayKey: '2026-12-01' }))
  assert.equal(report.vacantBedDays, 40)
  assert.equal(report.vacancyDays, 30)
  assert.equal(report.lastDay.vacant, 1)
  assert.equal(report.lastDay.occupied, 3)
  assert.equal(report.days[23].vacant, 1)
  assert.equal(report.capacityBedDays, 120)
  assert.ok(Math.abs(report.occupancyRate - 2 / 3 * 100) < 0.001)
})

test('ranks by vacant bed-days even with a zero price and includes fully occupied rooms', () => {
  const report = vacancyCalendar(calculate({ rooms: [room,
    { ...room, _id: 'r2', roomNumber: '2' },
    { ...room, _id: 'r3', roomNumber: '3', capacity: 1 }],
  contracts: [...contracts, { ...contract('s5', '01', '30'), room: 'r3' }] }))
  assert.deepEqual(report.map((row) => row.roomNumber), ['2', '17', '3'])
  assert.equal(report[2].vacancyDays, 0)
  assert.equal(report[2].occupancyRate, 100)
})

test('inactive days stay unknown and future months have no invented data', () => {
  const [report] = vacancyCalendar(calculate({ rooms: [{ ...room,
    createdAt: new Date('2026-11-02T00:00:00+05:00'),
    isDeleted: true, deletedAt: new Date('2026-11-04T00:00:00+05:00') }] }))
  assert.equal(report.days[0].vacant, null)
  assert.equal(report.days[1].vacant, 1)
  assert.equal(report.lastDay.available, false)
  assert.equal(report.vacancyDays, 2)
  assert.equal(report.capacityBedDays, 8)
  assert.deepEqual(vacancyCalendar(calculate({ period: '2026-12' })), [])
  assert.deepEqual(vacancyCalendar(undefined), [])
})
