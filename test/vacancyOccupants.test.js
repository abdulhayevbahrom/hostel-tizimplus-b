import test from 'node:test'
import assert from 'node:assert/strict'
import { vacancyOccupantContexts } from '../src/utils/vacancyOccupants.js'
import { vacancyLoss } from '../src/utils/vacancyLoss.js'

const rooms = [{ _id: 'old', roomNumber: '4', block: 'A', floor: '1', capacity: 2, status: 'available' },
  { _id: 'new', roomNumber: '4', block: 'B', floor: '2', capacity: 2, status: 'available' }]
const make = (extra = {}) => ({ _id: 'old-contract', student: { _id: 'student', fullName: 'Test talaba' },
  room: 'old', bedNumber: 1, startDate: new Date('2026-08-20'), endDate: new Date('2026-12-20'), status: 'active', ...extra })
const context = (contracts, roomMoves = []) => vacancyOccupantContexts({ contracts, rooms, roomMoves,
  todayStart: new Date('2026-11-25T19:00:00Z'), todayEnd: new Date('2026-11-26T18:59:59.999Z') })

test('current contract status and cancellation date appear on historical occupied days', () => {
  const contract = make({ status: 'cancelled', cancelledAt: new Date('2026-11-20T00:00:00+05:00') })
  const result = vacancyLoss({ period: '2026-11', todayKey: '2026-11-26', dailyRate: 0, rooms, contracts: [contract] })
  const occupant = result.daily[0].rooms.find((room) => room.id === 'old').bedOccupants[0]
  assert.equal(occupant.status, 'cancelled')
  assert.equal(occupant.cancelledAt, contract.cancelledAt)
  assert.equal(occupant.currentRoom, null)
  assert.equal(result.daily[20].rooms.find((room) => room.id === 'old').bedOccupants[0], null)
})

test('an old cancelled contract points to the student’s current room, including block and bed', () => {
  const old = make({ status: 'cancelled', cancelledAt: new Date('2026-11-20') })
  const current = make({ _id: 'new-contract', room: 'new', bedNumber: 2, startDate: new Date('2026-11-20') })
  const details = context([old, current]).get(old)
  assert.equal(details.status, 'cancelled')
  assert.deepEqual(details.previousRoom, { id: 'old', roomNumber: '4', block: 'A', floor: '1', bedNumber: 1 })
  assert.deepEqual(details.currentRoom, { id: 'new', roomNumber: '4', block: 'B', floor: '2', bedNumber: 2 })
})

test('future bookings, completed stays and deleted students are not shown as a current move', () => {
  const old = make()
  for (const candidate of [make({ _id: 'future', room: 'new', startDate: new Date('2026-12-01') }),
    make({ _id: 'completed', room: 'new', status: 'completed' }),
    make({ _id: 'deleted', room: 'new', student: { _id: 'student', isDeleted: true } })]) {
    const details = context([old, candidate]).get(old)
    assert.equal(details.previousRoom, null)
    assert.equal(details.currentRoom, null)
  }
})

test('editing the room on the same contract uses the latest actual room transfer, ignoring ordinary edits', () => {
  const current = make({ room: 'new', bedNumber: 2 })
  const moves = [
    { _id: 'normal', entityId: 'old-contract', createdAt: '2026-11-26', oldValue: { room: { _id: 'new' } }, newValue: { contract: { room: { id: 'new' } } } },
    { _id: 'move', entityId: 'old-contract', createdAt: '2026-11-20', oldValue: { room: { _id: 'old', roomNumber: '4' }, bedNumber: 1 }, newValue: { contract: { room: { id: 'new', roomNumber: '4' } } } },
  ]
  const details = context([current], moves).get(current)
  assert.equal(details.previousRoom.id, 'old')
  assert.equal(details.currentRoom.id, 'new')
  assert.equal(details.currentRoom.bedNumber, 2)
})

test('a stale transfer log and a bed-only change do not invent a room move', () => {
  const current = make({ room: 'old', bedNumber: 2 })
  const moves = [{ entityId: 'old-contract', createdAt: '2026-11-20', oldValue: { room: 'old' }, newValue: { room: 'new' } },
    { entityId: 'old-contract', createdAt: '2026-11-21', oldValue: { room: 'old', bedNumber: 1 }, newValue: { contract: { room: 'old', bedNumber: 2 } } }]
  assert.equal(context([current], moves).get(current).previousRoom, null)
})

test('completed contracts retain their status without claiming the student currently occupies a room', () => {
  const contract = make({ status: 'completed', endDate: new Date('2026-11-10') })
  assert.deepEqual(context([contract]).get(contract), { status: 'completed', cancelledAt: null, previousRoom: null, currentRoom: null })
})
