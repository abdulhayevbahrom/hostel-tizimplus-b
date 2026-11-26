import assert from 'node:assert/strict'
import test from 'node:test'
import { studentController } from '../src/controllers/studentController.js'
import { Student } from '../src/models/Student.js'
import { StudentContract } from '../src/models/StudentContract.js'
import { ContractInstallment } from '../src/models/ContractInstallment.js'
import { Payment } from '../src/models/Payment.js'
import { Room } from '../src/models/Room.js'

const queryResult = (value) => ({
  select() { return this },
  sort() { return this },
  lean() { return Promise.resolve(value) },
  populate() { return this },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject) },
})

test('contract creation date filters run before pagination and combine with room and student filters', async (t) => {
  const students = Array.from({ length: 30 }, (_, index) => ({ _id: String(index), id: String(index),
    studentStatus: 'green', toJSON() { return { id: this.id } } }))
  const allIds = students.map((student) => student.id)
  const matchingIds = allIds.slice(0, 27)
  const matches = (filter, id) => (!filter._id?.$in || filter._id.$in.includes(id))
    && (!filter._id?.$nin || !filter._id.$nin.includes(id)) && (filter.$and || []).every((part) => matches(part, id))
  let dateFilter
  t.mock.method(StudentContract, 'distinct', async (field, filter) => {
    if (field === '_id') return []
    if (filter?.createdAt) { dateFilter = filter; return matchingIds }
    if (filter?.room) return allIds.slice(1)
    return allIds
  })
  t.mock.method(Room, 'distinct', async () => ['room-1'])
  t.mock.method(Student, 'distinct', async (_, filter) => {
    assert.equal(filter.studentStatus, 'green')
    return allIds.filter((id) => matches(filter, id))
  })
  t.mock.method(StudentContract, 'find', () => queryResult([]))
  t.mock.method(ContractInstallment, 'find', () => queryResult([]))
  t.mock.method(Payment, 'find', () => queryResult([]))
  t.mock.method(Student, 'aggregate', async (pipeline) => {
    const ids = pipeline[0].$match._id.$in.map(String)
    const offset = pipeline.find((stage) => stage.$skip !== undefined).$skip
    const limit = pipeline.find((stage) => stage.$limit).$limit
    return students.filter((student) => ids.includes(student.id)).slice(offset, offset + limit)
  })
  t.mock.method(Student, 'find', (filter) => {
    let rows = students.filter((student) => matches(filter, student.id))
    const query = queryResult(rows)
    query.skip = (count) => { rows = rows.slice(count); return query }
    query.limit = (count) => queryResult(rows.slice(0, count))
    return query
  })
  let response
  await studentController.list({ query: { contractCreatedFrom: '2026-11-01', contractCreatedTo: '2026-11-25',
    room: '6ad7960a9dc576031fa78b2a', studentStatus: 'green', page: '2' } }, {
    status(code) { assert.equal(code, 200); return this }, json(body) { response = body.data },
  }, (error) => { throw error })
  assert.equal(dateFilter.createdAt.$gte.toISOString(), '2026-10-31T19:00:00.000Z')
  assert.equal(dateFilter.createdAt.$lt.toISOString(), '2026-11-25T19:00:00.000Z')
  assert.equal(dateFilter.startDate, undefined)
  assert.equal(response.pagination.total, 26)
  assert.deepEqual(response.students.map((student) => student.id), ['26'])
})

test('contract date filtering rejects invalid, incomplete or reversed ranges', async () => {
  for (const [from, to] of [['2026-02-30', '2026-03-01'], ['2026-11-25', '2026-11-01'], ['2026-11-01', undefined]]) {
    let status
    await studentController.list({ query: { contractCreatedFrom: from, contractCreatedTo: to } }, {
      status(code) { status = code; return this }, json() {},
    }, (error) => { throw error })
    assert.equal(status, 400)
  }
})

test('monthly payment filters apply before pagination and combine with other filters', async (t) => {
  const students = Array.from({ length: 29 }, (_, index) => ({
    _id: String(index), id: String(index), toJSON() { return { id: this.id } },
  }))
  const installment = (id, student, dueDate) => ({ _id: id, student, dueDate, amount: 100 })
  const installments = [
    ...students.slice(0, 26).map((student) => installment(`paid-${student.id}`, student.id, '2000-01-01')),
    installment('late', '26', '2000-01-01'),
    installment('pending', '27', '2100-01-01'),
    installment('mixed-pending', '26', '2100-01-01'),
  ]
  t.mock.method(Student, 'distinct', async (_, filter) => {
    assert.equal(filter.studentStatus, 'green')
    return students.map((student) => student.id)
  })
  t.mock.method(StudentContract, 'distinct', async () => [])
  t.mock.method(StudentContract, 'find', () => queryResult([]))
  t.mock.method(ContractInstallment, 'find', () => queryResult(installments))
  t.mock.method(Payment, 'find', () => queryResult([
    { paymentDate: '2000-02-01', allocations: students.slice(0, 26).map((student) => ({ installment: `paid-${student.id}`, amount: 100 })) },
    { paymentDate: '2000-02-01', allocations: [{ installment: 'late', amount: 25 }] },
    { paymentDate: '2000-02-03', allocations: [{ installment: 'late', amount: 25 }] },
  ]))
  let receivedFilter
  t.mock.method(Student, 'aggregate', async (pipeline) => {
    const ids = pipeline[0].$match._id.$in.map(String)
    const offset = pipeline.find((stage) => stage.$skip !== undefined).$skip
    const limit = pipeline.find((stage) => stage.$limit).$limit
    return students.filter((student) => ids.includes(student.id)).slice(offset, offset + limit)
  })
  t.mock.method(Student, 'find', (filter) => {
    receivedFilter = filter
    const selectedIds = filter._id.$in
    let rows = students.filter((student) => !selectedIds || selectedIds.includes(student.id))
    const query = queryResult(rows)
    query.skip = (count) => { rows = rows.slice(count); return query }
    query.limit = (count) => queryResult(rows.slice(0, count))
    return query
  })
  for (const [paymentStatus, page, expectedIds, total] of [
    ['fullyPaid', '2', ['25'], 26],
    ['late', '1', ['26'], 1],
    ['pending', '1', ['27'], 1],
    ['invalid', '2', ['25', '26', '27', '28'], 29],
  ]) {
    let response
    await studentController.list({ query: { paymentStatus, page, studentStatus: 'green' } }, {
      status(code) { assert.equal(code, 200); return this },
      json(body) { response = body.data },
    }, (error) => { throw error })
    assert.deepEqual(response.students.map((student) => student.id), expectedIds)
    assert.equal(response.pagination.total, total)
    assert.deepEqual(receivedFilter._id.$in.map(String), expectedIds)
    for (const student of response.students) {
      const expectedDueDate = student.id === '28' ? null : student.id === '27' ? '2100-01-01' : '2000-01-01'
      assert.equal(student.currentPaymentDueDate, expectedDueDate)
      const expectedLastPaidAt = ['27', '28'].includes(student.id) ? null : student.id === '26' ? '2000-02-03' : '2000-02-01'
      assert.equal(student.currentPaymentLastPaidAt, expectedLastPaidAt)
    }
  }
})
