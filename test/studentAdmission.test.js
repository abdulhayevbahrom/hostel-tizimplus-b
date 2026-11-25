import assert from 'node:assert/strict'
import test from 'node:test'
import mongoose from 'mongoose'
import { studentController } from '../src/controllers/studentController.js'
import { Student } from '../src/models/Student.js'
import { StudentContract } from '../src/models/StudentContract.js'
import { ContractInstallment } from '../src/models/ContractInstallment.js'
import { BlacklistEntry } from '../src/models/BlacklistEntry.js'
import { RoomBedError } from '../src/utils/roomBeds.js'
import { Room } from '../src/models/Room.js'

const roomId = new mongoose.Types.ObjectId()
const requestBody = () => ({
  student: { fullName: 'Ali Valiyev', phone: '939119572', gender: 'male', course: 2 },
  contract: { contractNumber: 'TTJ-2026-001', room: String(roomId), bedNumber: 1, startDate: '2026-11-25',
    endDate: '2027-02-25', paymentType: 'monthly', paymentAmount: 600000 },
})

const queryResult = (value) => ({
  select() { return this }, populate() { return this }, session() { return this },
  lean() { return Promise.resolve(value) },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject) },
})

function setup(t, { room = {}, occupied = 0, blocked = null, failAt } = {}) {
  const session = { pending: [] }
  const committed = []
  const events = []
  let transactionStarted = false
  t.mock.method(Room, 'findOneAndUpdate', async (_filter, _changes, options) => {
    assert.equal(options.session, session)
    return { _id: roomId, gender: 'male', status: 'available', capacity: 2, ...room }
  })
  t.mock.method(StudentContract, 'exists', () => queryResult(false))
  t.mock.method(StudentContract, 'find', () => queryResult(Array.from({ length: occupied }, (_, index) => ({
    _id: `old-${index}`, room: roomId, student: { _id: `resident-${index}` }, bedNumber: index + 1,
    status: 'active', startDate: '2026-11-01', endDate: '2027-03-01',
  }))))
  t.mock.method(BlacklistEntry, 'findOne', () => ({ session: () => Promise.resolve(blocked),
    then: (resolve, reject) => Promise.resolve(blocked).then(resolve, reject) }))
  t.mock.method(mongoose.connection, 'transaction', async (callback) => {
    transactionStarted = true
    await callback(session)
    committed.push(...session.pending)
  })
  for (const [Model, type] of [[Student, 'student'], [StudentContract, 'contract']]) {
    t.mock.method(Model.prototype, 'save', async function (options) {
      assert.equal(options.session, session)
      if (failAt === type) throw new Error(`${type} write failed`)
      session.pending.push({ type, document: this })
      return this
    })
  }
  t.mock.method(ContractInstallment, 'insertMany', async (rows, options) => {
    assert.equal(options.session, session)
    if (failAt === 'installments') throw new Error('installments write failed')
    session.pending.push(...rows.map((document) => ({ type: 'installment', document })))
  })
  const run = async (body = requestBody()) => {
    let status, response, error
    await studentController.admit({ body, app: { get: () => ({ emit: (event, data) => {
      assert.ok(committed.length, 'events are emitted only after commit')
      events.push({ event, data })
    } }) } }, {
      status(code) { status = code; return this }, json(value) { response = value; return this },
    }, (value) => { error = value; if (value instanceof RoomBedError) { status = value.status; response = { message: value.message } } })
    return { status, response, error }
  }
  return { run, committed, events, transactionStarted: () => transactionStarted }
}

test('admission saves existing student and contract models and monthly installments in one transaction', async (t) => {
  const state = setup(t)
  const body = requestBody()
  body.contract.student = String(new mongoose.Types.ObjectId())
  body.contract.status = 'cancelled'
  const { status, response, error } = await state.run(body)
  assert.equal(error, undefined)
  assert.equal(status, 201)
  const { student, contract } = response.data
  assert.equal(student.fullName, body.student.fullName)
  assert.equal(String(contract.student), student.id)
  assert.equal(contract.status, 'active')
  assert.equal(contract.totalAmount, 1800000)
  assert.deepEqual(state.committed.map((row) => row.type), ['student', 'contract', 'installment', 'installment', 'installment'])
  const installments = state.committed.filter((row) => row.type === 'installment').map((row) => row.document)
  assert.deepEqual(installments.map((row) => row.periodKey), ['2026-11', '2026-12', '2027-01'])
  assert.ok(installments.every((row) => String(row.student) === student.id && String(row.contract) === contract.id && row.amount === 600000))
  assert.deepEqual(state.events.map((row) => row.event), ['students:changed', 'student-contracts:changed', 'rooms:changed'])
})

test('daily admission preserves optional deposit and creates one installment with the full daily total', async (t) => {
  const state = setup(t)
  const body = requestBody()
  Object.assign(body.contract, { paymentType: 'daily', paymentAmount: 40000,
    endDate: '2026-11-30', depositEnabled: true, depositAmount: 200000 })
  const { status, response } = await state.run(body)
  assert.equal(status, 201)
  assert.equal(response.data.contract.totalAmount, 200000)
  assert.equal(response.data.contract.depositAmount, 200000)
  const installments = state.committed.filter((row) => row.type === 'installment')
  assert.equal(installments.length, 1)
  assert.equal(installments[0].document.amount, 200000)
})

test('incomplete or invalid student and contract data never starts saving', async (t) => {
  const state = setup(t)
  for (const change of [
    (body) => { delete body.student },
    (body) => { delete body.contract },
    (body) => { body.student.phone = '123' },
    (body) => { body.contract.endDate = body.contract.startDate },
    (body) => { body.contract.startDate = 'invalid' },
    (body) => { body.contract.paymentAmount = 0 },
    (body) => { body.contract.contractNumber = '' },
    (body) => { Object.assign(body.contract, { paymentType: 'daily', depositEnabled: true, depositAmount: 0 }) },
  ]) {
    const body = requestBody()
    change(body)
    const result = await state.run(body)
    assert.ok(result.status === 400 || result.error?.name === 'ValidationError')
  }
  assert.equal(state.transactionStarted(), false)
  assert.deepEqual(state.committed, [])
})

test('room availability, gender and maintenance checks reject admission before any student is saved', async (t) => {
  for (const options of [{ occupied: 2 }, { room: { gender: 'female' } }, { room: { status: 'maintenance' } }]) {
    await t.test(JSON.stringify(options), async (t) => {
      const state = setup(t, options)
      const { status } = await state.run()
      assert.ok(status === 400 || status === 409)
      assert.deepEqual(state.committed, [])
      assert.deepEqual(state.events, [])
    })
  }
})

test('blacklisted identities cannot be admitted', async (t) => {
  const state = setup(t, { blocked: { reason: 'Intizomiy sabab' } })
  const body = requestBody()
  body.student.jshr = '12345678901234'
  const { status, response } = await state.run(body)
  assert.equal(status, 409)
  assert.match(response.message, /Intizomiy sabab/)
  assert.equal(state.transactionStarted(), false)
})

test('a failed student, contract or installment write aborts admission and emits no success events', async (t) => {
  for (const failAt of ['student', 'contract', 'installments']) {
    await t.test(failAt, async (t) => {
      const state = setup(t, { failAt })
      const { status, error } = await state.run()
      assert.equal(status, undefined)
      assert.match(error.message, /write failed/)
      assert.equal(state.transactionStarted(), true)
      assert.deepEqual(state.committed, [])
      assert.deepEqual(state.events, [])
    })
  }
})
