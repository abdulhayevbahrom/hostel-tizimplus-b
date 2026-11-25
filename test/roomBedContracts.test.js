import assert from 'node:assert/strict'
import test from 'node:test'
import mongoose from 'mongoose'
import { studentContractController } from '../src/controllers/studentContractController.js'
import { roomController } from '../src/controllers/roomController.js'
import { StudentContract } from '../src/models/StudentContract.js'
import { Student } from '../src/models/Student.js'
import { Room } from '../src/models/Room.js'
import { ContractInstallment } from '../src/models/ContractInstallment.js'

const query = (value) => ({ select() { return this }, sort() { return this }, populate() { return this }, session() { return this },
  lean() { return Promise.resolve(value) }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject) } })
const roomId = new mongoose.Types.ObjectId(), studentId = new mongoose.Types.ObjectId(), contractId = new mongoose.Types.ObjectId()
const room = { _id: roomId, id: String(roomId), roomNumber: '4', capacity: 4, gender: 'female', status: 'available', block: 'A', floor: '1' }
const payload = { student: String(studentId), room: String(roomId), bedNumber: 3, contractNumber: 'TEST',
  startDate: '2026-11-25', endDate: '2026-12-25', paymentType: 'monthly', paymentAmount: 400000, status: 'active' }
const current = () => ({ _id: contractId, ...payload, startDate: new Date(payload.startDate), endDate: new Date(payload.endDate),
  cancelledAt: null, student: studentId, room: roomId })
const request = (body = payload) => ({ body, params: { id: String(contractId) }, app: { get: () => ({ emit() {} }) } })
const response = () => ({ status(code) { this.code = code; return this }, json(body) { this.body = body; return this } })

function bookingMocks(t, occupants = []) {
  const session = {}, steps = []
  t.mock.method(mongoose.connection, 'transaction', async (callback) => callback(session))
  t.mock.method(Room, 'findOneAndUpdate', async (_filter, _changes, options) => { assert.equal(options.session, session); steps.push('lock'); return room })
  t.mock.method(Student, 'findById', () => query({ _id: studentId, gender: 'female' }))
  t.mock.method(StudentContract, 'exists', () => query(false))
  t.mock.method(StudentContract, 'find', () => query(occupants))
  return { session, steps }
}

test('standalone contract creation commits its selected bed and installments in the same transaction', async (t) => {
  const { session, steps } = bookingMocks(t)
  t.mock.method(StudentContract.prototype, 'save', async function (options) { assert.equal(options.session, session); steps.push('save'); return this })
  t.mock.method(StudentContract.prototype, 'populate', async function () { return this })
  t.mock.method(ContractInstallment, 'insertMany', async (_rows, options) => { assert.equal(options.session, session); steps.push('installments') })
  const res = response()
  await studentContractController.create(request(), res, (error) => { throw error })
  assert.equal(res.code, 201)
  assert.equal(res.body.data.contract.bedNumber, 3)
  assert.deepEqual(steps, ['lock', 'save', 'installments'])
})

test('editing a current contract retains its own bed without treating itself as another resident', async (t) => {
  const existing = current()
  const { session } = bookingMocks(t, [{ ...existing, student: { _id: studentId } }])
  t.mock.method(StudentContract, 'findById', () => query(existing))
  let changes
  t.mock.method(StudentContract, 'findByIdAndUpdate', (_id, update, options) => {
    assert.equal(options.session, session); changes = update; return query({ ...existing, ...update })
  })
  const res = response(), body = { ...payload }
  delete body.bedNumber // Preserve the current number for compatible existing clients.
  await studentContractController.update(request(body), res, (error) => { throw error })
  assert.equal(res.code, 200)
  assert.equal(changes.bedNumber, 3)
})

test('extending dates cannot overlap another resident on the same bed', async (t) => {
  bookingMocks(t, [{ _id: new mongoose.Types.ObjectId(), student: { _id: new mongoose.Types.ObjectId() },
    bedNumber: 3, startDate: '2027-01-01', endDate: '2027-02-01', status: 'active' }])
  t.mock.method(StudentContract, 'findById', () => query(current()))
  const update = t.mock.method(StudentContract, 'findByIdAndUpdate', () => { throw new Error('Must not write') })
  let error
  await studentContractController.update(request({ ...payload, endDate: '2027-01-15' }), response(), (value) => { error = value })
  assert.equal(error.status, 409)
  assert.match(error.message, /3-o‘rin.*band/)
  assert.equal(update.mock.callCount(), 0)
})

test('room availability API returns the exact free numbers for the requested dates and excludes an edited contract', async (t) => {
  const existing = { ...current(), student: { _id: studentId, fullName: 'Test talaba' } }
  t.mock.method(Room, 'findById', async () => room)
  t.mock.method(StudentContract, 'find', () => query([existing]))
  for (const [excludeContractId, expected] of [[undefined, [1, 2, 4]], [String(contractId), [1, 2, 3, 4]]]) {
    const res = response()
    await roomController.beds({ params: { id: String(roomId) }, query: { startDate: '2026-11-25', endDate: '2026-12-25', excludeContractId } }, res,
      (error) => { throw error })
    assert.equal(res.code, 200)
    assert.deepEqual(res.body.data.availableBeds, expected)
  }
})
