import assert from 'node:assert/strict'
import test from 'node:test'
import mongoose from 'mongoose'
import { assignLegacyBedNumbers, RoomBedError, roomBedState, staysOverlap } from '../src/utils/roomBeds.js'
import { lockRooms, reserveRoomBed, migrateLegacyRoomBeds } from '../src/services/roomBeds.js'
import { Room } from '../src/models/Room.js'
import { Student } from '../src/models/Student.js'
import { StudentContract } from '../src/models/StudentContract.js'

const room = { _id: new mongoose.Types.ObjectId(), roomNumber: '4', capacity: 4, status: 'available', gender: 'male' }
const stay = (id, startDate = '2026-11-01', endDate = '2026-11-30', extra = {}) => ({
  _id: id, student: { _id: `student-${id}`, fullName: `Talaba ${id}` }, room: room._id,
  startDate, endDate, createdAt: startDate, status: 'active', ...extra,
})
const query = (value) => ({ select() { return this }, sort() { return this }, populate() { return this }, session() { return this },
  lean() { return Promise.resolve(value) }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject) } })

test('legacy residents receive stable numbers by start date, then creation date and id', () => {
  const contracts = [stay('new', '2026-11-20'), stay('first', '2026-10-01'),
    stay('b', '2026-11-01', undefined, { createdAt: '2026-10-25' }), stay('a', '2026-11-01', undefined, { createdAt: '2026-10-25' })]
  const plan = assignLegacyBedNumbers(room, contracts)
  assert.deepEqual(plan.assignments.map((item) => [item.contractId, item.bedNumber]), [['first', 1], ['a', 2], ['b', 3], ['new', 4]])
  assert.deepEqual(assignLegacyBedNumbers(room, plan.contracts).assignments, [])
  assert.ok(contracts.every((item) => item.bedNumber === undefined), 'dry-run planning does not mutate the input')
})

test('existing numbers never change when older residents are imported or another resident leaves', () => {
  const numbered = stay('existing', '2026-11-05', '2026-11-30', { bedNumber: 3 })
  const plan = assignLegacyBedNumbers(room, [numbered, stay('older', '2026-11-01')])
  assert.deepEqual(plan.assignments, [{ contractId: 'older', bedNumber: 1 }])
  assert.equal(plan.contracts.find((item) => item._id === 'existing').bedNumber, 3)
  assert.equal(roomBedState(room, [numbered], { startDate: '2026-11-10', endDate: '2026-11-20' })[2].occupied, true)
})

test('nonoverlapping stays reuse a number, while a shared departure day stays occupied in Tashkent time', () => {
  const smallRoom = { ...room, capacity: 1 }
  const first = stay('first', '2026-11-01', '2026-11-10')
  const second = stay('second', '2026-11-11', '2026-11-20')
  assert.deepEqual(assignLegacyBedNumbers(smallRoom, [second, first]).assignments.map((row) => row.bedNumber), [1, 1])
  assert.equal(staysOverlap(first, { startDate: '2026-11-09T19:00:00Z', endDate: '2026-11-20' }), true)
  assert.equal(staysOverlap(first, second), false)
  assert.throws(() => assignLegacyBedNumbers(smallRoom, [first, stay('same-day', '2026-11-10')]), RoomBedError)
})

test('overcapacity, invalid numbers and duplicate numbered reservations are reported without renumbering', () => {
  for (const contracts of [
    Array.from({ length: 5 }, (_, i) => stay(String(i))),
    [stay('bad', undefined, undefined, { bedNumber: 5 })],
    [stay('a', undefined, undefined, { bedNumber: 2 }), stay('b', undefined, undefined, { bedNumber: 2 })],
  ]) assert.throws(() => assignLegacyBedNumbers(room, contracts), RoomBedError)
})

test('availability includes future reservations, excludes cancellations/deletions, and can exclude the contract being edited', () => {
  const contracts = [stay('first', '2026-12-05', '2026-12-20', { bedNumber: 2 }),
    stay('cancelled', '2026-12-01', '2026-12-30', { bedNumber: 1, status: 'cancelled' }),
    stay('deleted', '2026-12-01', '2026-12-30', { bedNumber: 3, isDeleted: true }),
    stay('deleted-student', '2026-12-01', '2026-12-30', { bedNumber: 4, student: { _id: 'deleted', isDeleted: true } })]
  const range = { startDate: '2026-12-01', endDate: '2026-12-31' }
  const beds = roomBedState(room, contracts, range)
  assert.deepEqual(beds.filter((bed) => bed.available).map((bed) => bed.number), [1, 3, 4])
  assert.equal(beds[1].occupants[0].fullName, 'Talaba first')
  assert.equal(roomBedState(room, contracts, range, 'first').every((bed) => bed.available), true)
  assert.equal(roomBedState({ ...room, status: 'maintenance' }, [], range).some((bed) => bed.available), false)
})

test('room locks are acquired in a consistent order and use the booking transaction session', async (t) => {
  const session = {}, ids = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()]
  const calls = []
  t.mock.method(Room, 'findOneAndUpdate', async (filter, changes, options) => {
    assert.equal(options.session, session)
    assert.deepEqual(changes, { $inc: { bookingVersion: 1 } })
    calls.push(filter._id)
    return { _id: filter._id }
  })
  await lockRooms([ids[1], ids[0], ids[1]], session)
  assert.deepEqual(calls, ids.map(String).sort())
})

test('a stale client cannot reserve a now-occupied bed, while another free bed remains bookable', async (t) => {
  const session = {}, steps = []
  t.mock.method(Room, 'findOneAndUpdate', async (_filter, _changes, options) => {
    assert.equal(options.session, session); steps.push('lock'); return room
  })
  t.mock.method(Student, 'findById', () => query({ _id: 'new-student', gender: 'male' }))
  t.mock.method(StudentContract, 'exists', () => query(false))
  t.mock.method(StudentContract, 'find', () => {
    assert.equal(steps.at(-1), 'lock', 'availability is read after the transaction acquires the room lock')
    return query([stay('existing', undefined, undefined, { bedNumber: 2 })])
  })
  const payload = { room: room._id, student: 'new-student', bedNumber: 2, startDate: '2026-11-10', endDate: '2026-11-20', status: 'active' }
  await assert.rejects(reserveRoomBed(payload, session), /2-o‘rin.*band/)
  await reserveRoomBed({ ...payload, bedNumber: 1 }, session)
  await assert.rejects(reserveRoomBed({ ...payload, bedNumber: 9 }, session), /1 dan 4/)
})

test('migration defaults to a dry run and writes missing bed numbers transactionally without changing original timestamps', async (t) => {
  const studentId = new mongoose.Types.ObjectId(), contractId = new mongoose.Types.ObjectId()
  const original = stay(contractId, undefined, undefined, { student: { _id: studentId } })
  const stored = [original]
  const session = {}, writes = []
  t.mock.method(Room, 'find', () => query([room]))
  t.mock.method(Room, 'findOneAndUpdate', async () => room)
  t.mock.method(StudentContract, 'find', () => query(stored))
  t.mock.method(mongoose.connection, 'transaction', async (callback) => callback(session))
  t.mock.method(StudentContract, 'bulkWrite', async (operations, options) => {
    assert.equal(options.session, session)
    assert.equal(operations[0].updateOne.timestamps, false)
    writes.push(operations)
    original.bedNumber = operations[0].updateOne.update.$set.bedNumber
  })
  const preview = await migrateLegacyRoomBeds()
  assert.equal(preview.assignedContracts, 1)
  assert.equal(writes.length, 0)
  const applied = await migrateLegacyRoomBeds({ dryRun: false })
  assert.equal(applied.assignedContracts, 1)
  assert.equal(original.bedNumber, 1)
  assert.equal((await migrateLegacyRoomBeds({ dryRun: false })).assignedContracts, 0)
  assert.equal(writes.length, 1)
})
