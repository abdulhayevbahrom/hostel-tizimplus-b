import assert from 'node:assert/strict'
import test from 'node:test'
import { contractExpiryRange } from '../src/utils/contractExpiry.js'
import { studentController } from '../src/controllers/studentController.js'
import { studentContractController } from '../src/controllers/studentContractController.js'
import { Student } from '../src/models/Student.js'
import { StudentContract } from '../src/models/StudentContract.js'
import { ContractInstallment } from '../src/models/ContractInstallment.js'
import { Payment } from '../src/models/Payment.js'
import { Room } from '../src/models/Room.js'

const queryResult = (value) => ({
  select() { return this },
  populate() { return this },
  sort() { return this },
  lean: async () => value,
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject) },
})

const responseCapture = () => {
  const result = { code: null, data: null }
  return { result, status(code) { result.code = code; return this }, json(body) { result.data = body.data } }
}
const fail = (error) => { throw error }

test('expiry ranges include both Tashkent calendar dates, including one day and leap day', () => {
  assert.deepEqual(contractExpiryRange({}), {})
  for (const [from, to, start, end] of [
    ['2026-12-01', '2026-12-31', '2026-11-30T19:00:00.000Z', '2026-12-31T19:00:00.000Z'],
    ['2028-02-29', '2028-02-29', '2028-02-28T19:00:00.000Z', '2028-02-29T19:00:00.000Z'],
  ]) {
    const range = contractExpiryRange({ contractEndFrom: from, contractEndTo: to })
    assert.equal(range.$gte.toISOString(), start)
    assert.equal(range.$lt.toISOString(), end)
  }
})

test('both lists reject invalid, incomplete and reversed expiry ranges', async () => {
  for (const [contractEndFrom, contractEndTo] of [
    ['2026-02-30', '2026-03-01'], ['2026-11-25', '2026-11-01'],
    ['2026-11-01', undefined], [undefined, '2026-11-25'], ['invalid', '2026-11-25'],
  ]) {
    for (const list of [studentController.list, studentContractController.listActive]) {
      const response = responseCapture()
      await list({ query: { contractEndFrom, contractEndTo } }, response, fail)
      assert.equal(response.result.code, 400)
    }
  }
})

test('student expiry filtering intersects room and status filters before pagination and preserves deadline order', async (t) => {
  const students = Array.from({ length: 30 }, (_, index) => ({
    _id: String(index), id: String(index), toJSON() { return { id: this.id } },
  }))
  const allIds = students.map((student) => student.id)
  const roomIds = allIds.slice(1)
  const expiryIds = allIds.slice(0, 28)
  const matches = (filter, id) => (!filter._id?.$in || filter._id.$in.includes(id))
    && (!filter._id?.$nin || !filter._id.$nin.includes(id))
    && (filter.$and || []).every((part) => matches(part, id))
  let expiryFilter
  t.mock.method(Room, 'distinct', async () => ['room-1'])
  t.mock.method(StudentContract, 'distinct', async (field, filter) => {
    if (field === '_id') return []
    if (filter?.room) return roomIds
    if (filter?.endDate?.$lt) { expiryFilter = filter; return expiryIds }
    return allIds
  })
  t.mock.method(Student, 'distinct', async (_, filter) => {
    assert.equal(filter.studentStatus, 'green')
    return allIds.filter((id) => matches(filter, id))
  })
  t.mock.method(Student, 'aggregate', async (pipeline) => {
    assert.deepEqual(pipeline[0].$match._id.$in, allIds.slice(1, 28))
    const lookup = pipeline.find((stage) => stage.$lookup).$lookup
    assert.equal(lookup.localField, '_id')
    assert.equal(lookup.foreignField, 'student')
    assert.equal(lookup.pipeline[0].$match.status, 'active')
    assert.deepEqual(lookup.pipeline[0].$match.isDeleted, { $ne: true })
    assert.deepEqual(lookup.pipeline[1].$group.endDate, { $min: '$endDate' })
    const sortIndex = pipeline.findIndex((stage) => stage.$sort)
    assert.equal(pipeline[sortIndex].$sort.contractEndSort, 1)
    assert.equal(pipeline[sortIndex + 1].$skip, 25)
    assert.equal(pipeline[sortIndex + 2].$limit, 25)
    const fallback = pipeline.find((stage) => stage.$addFields).$addFields.contractEndSort.$ifNull[1]
    assert.equal(fallback.toISOString(), '9999-12-31T00:00:00.000Z')
    return [{ _id: '27' }, { _id: '26' }]
  })
  // MongoDB's $in does not preserve the order of the requested ids.
  t.mock.method(Student, 'find', () => queryResult(students.slice(26, 28)))
  t.mock.method(StudentContract, 'find', (filter) => {
    assert.deepEqual(filter.endDate, expiryFilter.endDate)
    return queryResult([
      { student: '27', endDate: '2099-12-10', room: { roomNumber: '1' } },
      { student: '26', endDate: '2099-12-11', room: { roomNumber: '2' } },
      { student: '27', endDate: '2099-12-20', room: { roomNumber: '3' } },
    ])
  })
  t.mock.method(ContractInstallment, 'find', () => queryResult([]))
  t.mock.method(Payment, 'find', () => queryResult([]))
  const response = responseCapture()
  await studentController.list({ query: {
    contractEndFrom: '2099-12-01', contractEndTo: '2099-12-31',
    room: '6ad7960a9dc576031fa78b2a', studentStatus: 'green', page: '2',
  } }, response, fail)
  assert.equal(response.result.code, 200)
  assert.equal(response.result.data.pagination.total, 27)
  assert.deepEqual(response.result.data.students.map((student) => student.id), ['27', '26'])
  assert.equal(response.result.data.students[0].activeContractEndDate, '2099-12-10')
  assert.equal(expiryFilter.endDate.$gte.toISOString(), '2099-11-30T19:00:00.000Z')
  assert.equal(expiryFilter.endDate.$lt.toISOString(), '2099-12-31T19:00:00.000Z')
})

test('contracts use the same expiry scope and ascending deadline order for pages, page clamping and export', async (t) => {
  const room = '6ad7960a9dc576031fa78b2a'
  t.mock.method(Room, 'distinct', async () => [room])
  t.mock.method(Student, 'distinct', async () => ['student-1'])
  let totalFilter
  t.mock.method(StudentContract, 'countDocuments', async (filter) => { totalFilter = filter; return 27 })
  const pipelines = []
  t.mock.method(StudentContract, 'aggregate', async (pipeline) => {
    pipelines.push(pipeline)
    assert.deepEqual(pipeline[0].$match, totalFilter)
    assert.deepEqual(pipeline[1].$sort, { endDate: 1, createdAt: -1, _id: 1 })
    return [{ _id: 'near' }, { _id: 'far' }]
  })
  t.mock.method(StudentContract, 'find', (filter) => queryResult(filter._id ? [
    { id: 'far', student: {}, room: {}, endDate: '2099-12-20' },
    { id: 'near', student: {}, room: {}, endDate: '2099-12-10' },
  ] : []))
  t.mock.method(ContractInstallment, 'aggregate', async () => [])
  t.mock.method(Payment, 'aggregate', async () => [])
  for (const [page, exportValue, expectedSkip, expectedLimit] of [
    ['2', undefined, 25, 25], ['99', undefined, 25, 25], ['1', '1', 0, 5000],
  ]) {
    pipelines.length = 0
    const response = responseCapture()
    await studentContractController.listActive({ query: {
      page, export: exportValue, room, search: 'Ali', contractType: 'student_contract',
      contractEndFrom: '2099-12-01', contractEndTo: '2099-12-31',
    } }, response, fail)
    assert.equal(response.result.code, 200)
    assert.equal(totalFilter.room.toString(), room)
    assert.equal(totalFilter.room.constructor.name, 'ObjectId')
    assert.equal(totalFilter.status, 'active')
    assert.ok(totalFilter.$or.length)
    assert.equal(totalFilter.endDate.$gte.toISOString(), '2099-11-30T19:00:00.000Z')
    assert.equal(totalFilter.endDate.$lt.toISOString(), '2099-12-31T19:00:00.000Z')
    assert.equal(pipelines.at(-1)[2].$skip, expectedSkip)
    assert.equal(pipelines.at(-1)[3].$limit, expectedLimit)
    assert.equal(pipelines.length, page === '99' ? 2 : 1)
    assert.deepEqual(response.result.data.contracts.map((contract) => contract.id), ['near', 'far'])
  }
})
