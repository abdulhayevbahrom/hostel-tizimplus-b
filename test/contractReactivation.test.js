import assert from 'node:assert/strict'
import test from 'node:test'
import mongoose from 'mongoose'
import { studentContractController } from '../src/controllers/studentContractController.js'
import { StudentContract } from '../src/models/StudentContract.js'
import { Student } from '../src/models/Student.js'
import { Room } from '../src/models/Room.js'

const ids = { contract: new mongoose.Types.ObjectId(), student: new mongoose.Types.ObjectId(), old: new mongoose.Types.ObjectId(), next: new mongoose.Types.ObjectId() }
const query = (value) => ({ session() { return this }, select() { return this }, populate() { return this },
  lean() { return Promise.resolve(value) }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject) } })

function setup(t, { status = 'cancelled', occupied = false, otherActive = false, installmentsFail = false } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-26T07:00:00Z') })
  const existing = { _id: ids.contract, student: ids.student, room: ids.old, bedNumber: 2,
    contractNumber: 'OLD-1', startDate: new Date('2026-08-20'), endDate: new Date('2026-11-20'),
    paymentType: 'monthly', paymentAmount: 400000, status,
    cancelledAt: status === 'cancelled' ? new Date('2026-11-15') : null }
  const session = {}, locks = [], writes = [], installments = [], events = []
  const rooms = [ids.old, ids.next].map((_id, i) => ({ _id, roomNumber: String(i + 4), capacity: 2, status: 'available', gender: 'female' }))
  t.mock.method(mongoose.connection, 'transaction', async (callback) => callback(session))
  t.mock.method(StudentContract, 'findById', () => query(existing))
  t.mock.method(Room, 'findOneAndUpdate', async ({ _id }, _changes, options) => {
    assert.equal(options.session, session)
    locks.push(String(_id))
    return rooms.find((room) => String(room._id) === String(_id))
  })
  t.mock.method(Student, 'findById', () => query({ _id: ids.student, gender: 'female' }))
  t.mock.method(StudentContract, 'exists', () => query(otherActive))
  t.mock.method(StudentContract, 'find', ({ room }) => query(occupied && String(room) === String(ids.old) ? [{
    _id: new mongoose.Types.ObjectId(), student: { _id: new mongoose.Types.ObjectId() }, room: ids.old,
    bedNumber: 2, status: 'active', startDate: '2026-11-21', endDate: '2027-02-01',
  }] : []))
  t.mock.method(StudentContract, 'findByIdAndUpdate', (_id, changes, options) => {
    assert.equal(options.session, session)
    writes.push(changes)
    return query({ ...existing, ...changes })
  })
  t.mock.method(studentContractController, 'updateInstallments', async (contract, usedSession) => {
    assert.equal(usedSession, session)
    installments.push(contract)
    if (installmentsFail) throw new Error('Installment write failed')
  })
  const run = async (changes = {}) => {
    const req = { params: { id: String(ids.contract) }, body: { ...existing,
      student: String(ids.student), room: String(ids.old), startDate: '2026-08-20', endDate: '2026-12-20', status: 'active', ...changes },
      app: { get: () => ({ emit: (...args) => events.push(args) }) } }
    const result = {}
    await studentContractController.update(req, { status(code) { result.status = code; return this },
      json(body) { result.body = body; return this } }, (error) => { result.error = error })
    return result
  }
  return { run, existing, locks, writes, installments, events }
}

test('a cancelled contract reactivates with new dates at its free old bed and clears the cancellation date', async (t) => {
  const state = setup(t)
  const result = await state.run()
  assert.equal(result.status, 200)
  const contract = result.body.data.contract
  assert.equal(String(contract._id), String(ids.contract))
  assert.equal(contract.status, 'active')
  assert.equal(contract.cancelledAt, null)
  assert.equal(contract.bedNumber, 2)
  assert.equal(String(contract.room), String(ids.old))
  assert.equal(state.installments.length, 1)
  assert.deepEqual(state.locks, [String(ids.old)])
})

test('completed contracts can also be extended and reactivated', async (t) => {
  const state = setup(t, { status: 'completed' })
  const result = await state.run()
  assert.equal(result.status, 200)
  assert.equal(result.body.data.contract.status, 'active')
  assert.equal(result.body.data.contract.cancelledAt, null)
})

test('an occupied old bed rejects reactivation without changing the contract', async (t) => {
  const state = setup(t, { occupied: true })
  const result = await state.run()
  assert.equal(result.error.status, 409)
  assert.match(result.error.message, /2-o‘rin.*band/)
  assert.equal(state.writes.length, 0)
  assert.equal(state.events.length, 0)
  assert.equal(state.existing.status, 'cancelled')
  assert.equal(state.existing.cancelledAt.toISOString(), '2026-11-15T00:00:00.000Z')
})

test('a replacement room and free bed can be selected when the old bed is occupied', async (t) => {
  const state = setup(t, { occupied: true })
  const result = await state.run({ room: String(ids.next), bedNumber: 1 })
  assert.equal(result.status, 200)
  assert.equal(result.body.data.contract.status, 'active')
  assert.equal(String(result.body.data.contract.room), String(ids.next))
  assert.equal(result.body.data.contract.bedNumber, 1)
  assert.deepEqual(state.locks, [String(ids.next)], 'an inactive old room is not reserved again')
})

test('an ended date cannot be submitted as an active reactivation', async (t) => {
  const state = setup(t)
  const result = await state.run({ endDate: '2026-11-25' })
  assert.equal(result.status, 400)
  assert.match(result.body.message, /tugash sanasi/)
  assert.equal(state.writes.length, 0)
  assert.equal(state.locks.length, 0)
})

test('reactivation does not create a second active contract for the same student', async (t) => {
  const state = setup(t, { otherActive: true })
  const result = await state.run()
  assert.equal(result.error.status, 409)
  assert.match(result.error.message, /boshqa aktiv shartnomasi/)
  assert.equal(state.writes.length, 0)
})

test('a date-only edit can leave a cancelled contract cancelled even if its old bed has been occupied', async (t) => {
  const state = setup(t, { occupied: true })
  const result = await state.run({ status: 'cancelled' })
  assert.equal(result.status, 200)
  assert.equal(result.body.data.contract.status, 'cancelled')
  assert.equal(result.body.data.contract.cancelledAt, state.existing.cancelledAt)
  assert.equal(state.locks.length, 0)
})

test('installment failure rejects the transactional update and never announces a successful reactivation', async (t) => {
  const state = setup(t, { installmentsFail: true })
  const result = await state.run()
  assert.match(result.error.message, /Installment write failed/)
  assert.equal(result.status, undefined)
  assert.equal(state.events.length, 0)
})
