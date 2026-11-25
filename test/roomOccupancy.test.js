import assert from 'node:assert/strict'
import test from 'node:test'
import mongoose from 'mongoose'
import { roomController } from '../src/controllers/roomController.js'
import { Room } from '../src/models/Room.js'
import { StudentContract } from '../src/models/StudentContract.js'
import { ContractInstallment } from '../src/models/ContractInstallment.js'
import { vacancyLoss } from '../src/utils/vacancyLoss.js'

const roomId = new mongoose.Types.ObjectId()
const room = { _id: roomId, id: String(roomId), roomNumber: '3', floor: '2', block: '', capacity: 9, status: 'available' }
const query = (value) => ({ select() { return this }, sort() { return this }, populate() { return this },
  lean() { return Promise.resolve(value) }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject) } })
const response = () => ({ status(code) { this.code = code; return this }, json(body) { this.data = body.data; return this } })
const stay = (number, extra = {}) => ({ _id: new mongoose.Types.ObjectId(), id: `contract-${number}`, room: roomId,
  student: { _id: `student-${number}`, id: `student-${number}`, fullName: `Talaba ${number}` }, bedNumber: number,
  startDate: '2026-09-01', endDate: '2027-06-30', status: 'active', ...extra })

function mockRooms(t, contracts) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-25T07:00:00Z') })
  t.mock.method(Room, 'find', () => query([{ ...room, toJSON: () => ({ ...room }) }]))
  t.mock.method(Room, 'findById', async () => room)
  t.mock.method(StudentContract, 'find', (filter) => {
    assert.equal(filter.status, 'active')
    assert.equal(filter.startDate.$lte.toISOString(), '2026-11-25T18:59:59.999Z')
    assert.equal(filter.endDate.$gte.toISOString(), '2026-11-24T19:00:00.000Z')
    // Return all records so the test also checks the shared residency rule.
    return query(contracts)
  })
  t.mock.method(ContractInstallment, 'find', () => query([]))
}

async function occupancy(contracts) {
  const cards = response(), residents = response()
  const next = (error) => { throw error }
  await roomController.list({ query: { period: '2026-11' } }, cards, next)
  await roomController.students({ params: { id: String(roomId) }, query: { period: '2026-11' } }, residents, next)
  const dashboard = vacancyLoss({ period: '2026-11', todayKey: '2026-11-25', dailyRate: 40000, rooms: [room], contracts })
  return { card: cards.data.rooms[0], residents: residents.data, dashboard, today: dashboard.daily.at(-1).rooms[0] }
}

test('room 3 shows eight current residents and a free ninth bed in the card, table and dashboard', async (t) => {
  const contracts = [...Array.from({ length: 8 }, (_, index) => stay(index + 1)),
    stay(9, { status: 'completed', startDate: '2026-11-05', endDate: '2026-11-07' })]
  mockRooms(t, contracts)
  const { card, residents, dashboard, today } = await occupancy(contracts)
  assert.equal(card.occupiedCount, 8)
  assert.deepEqual(card.availableBeds, [9])
  assert.equal(residents.students.length, 8)
  assert.equal(residents.occupiedCount, 8)
  assert.equal(residents.availableCount, 1)
  assert.equal(dashboard.live.todayVacantBeds, 1)
  assert.deepEqual(today.bedStates, card.beds.map((bed) => bed.occupied ? 'occupied' : 'vacant'))
  assert.equal(today.bedOccupants[8], null)
  assert.equal(dashboard.daily[5].rooms[0].bedStates[8], 'occupied', 'past occupancy is preserved')
})

for (const status of ['active', 'completed', 'cancelled']) {
  test(`${status} contract with current dates has consistent occupancy in all three views`, async (t) => {
    const contracts = [stay(9, { status })]
    mockRooms(t, contracts)
    const { card, residents, today } = await occupancy(contracts)
    const occupied = status === 'active'
    assert.equal(card.beds[8].occupied, occupied)
    assert.equal(residents.students.length, occupied ? 1 : 0)
    assert.equal(today.bedStates[8], occupied ? 'occupied' : 'vacant')
  })
}

test('future, expired and deleted stays do not occupy current beds despite a stale active status', async (t) => {
  const contracts = [stay(1, { startDate: '2026-11-26' }), stay(2, { endDate: '2026-11-24' }),
    stay(3, { isDeleted: true }), stay(4, { student: { _id: 'deleted-student', isDeleted: true } })]
  mockRooms(t, contracts)
  const { card, residents, today } = await occupancy(contracts)
  assert.equal(card.occupiedCount, 0)
  assert.equal(residents.students.length, 0)
  assert.equal(today.bedStates.every((state) => state === 'vacant'), true)
})
