import assert from 'node:assert/strict'
import test from 'node:test'
import { studentController } from '../src/controllers/studentController.js'
import { Student } from '../src/models/Student.js'
import { StudentContract } from '../src/models/StudentContract.js'
import { ContractInstallment } from '../src/models/ContractInstallment.js'
import { Payment } from '../src/models/Payment.js'
import { Room } from '../src/models/Room.js'
import { createStudentsWorkbook } from '../../frontend/src/utils/studentsExcel.js'

const queryResult = (value) => ({
  select() { return this },
  populate() { return this },
  sort() { return this },
  lean: async () => value,
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject) },
})

for (const scenario of ['all', 'filtered', 'empty']) {
  test(`student Excel export returns ${scenario} results across every page in table order`, async (t) => {
    const students = Array.from({ length: scenario === 'all' ? 5001 : 31 }, (_, index) => ({
      _id: String(index), id: String(index), toJSON() { return { id: this.id, fullName: `Talaba ${index}` } },
    }))
    const allIds = students.map((student) => student.id)
    const matchingIds = scenario === 'empty' ? [] : scenario === 'filtered' ? allIds.slice(1, 30) : allIds
    const matches = (filter, id) => (!filter._id?.$in || filter._id.$in.includes(id))
      && (filter.$and || []).every((part) => matches(part, id))
    const objectId = '6ad7960a9dc576031fa78b2a'
    t.mock.method(Room, 'distinct', async (_, filter) => {
      assert.equal(filter._id, objectId)
      assert.equal(filter.floor, '2')
      return ['room-1']
    })
    t.mock.method(StudentContract, 'distinct', async (field, filter) => {
      if (field === '_id') return []
      if (filter?.room || filter?.createdAt || filter?.endDate?.$lt) return matchingIds
      return allIds
    })
    t.mock.method(Student, 'distinct', async (_, filter) => {
      if (scenario === 'filtered') {
        assert.equal(filter.university, objectId)
        assert.equal(filter.faculty, objectId)
        assert.deepEqual(filter.course, { $in: [1, 2] })
        assert.equal(filter.educationType, 'daytime')
        assert.equal(filter.studentStatus, 'green')
        assert.equal(filter.$or[0].fullName.$regex, 'Talaba')
        return allIds.filter((id) => matches(filter, id))
      }
      assert.equal(filter.university, undefined)
      return matchingIds
    })
    const paidIds = allIds.slice(1, 28)
    t.mock.method(ContractInstallment, 'find', () => queryResult(scenario === 'filtered'
      ? allIds.map((id) => ({ _id: `installment-${id}`, student: id, amount: 100, dueDate: '2000-01-01' })) : []))
    t.mock.method(Payment, 'find', () => queryResult([{
      paymentDate: '2000-01-01', allocations: paidIds.map((id) => ({ installment: `installment-${id}`, amount: 100 })),
    }]))
    t.mock.method(Student, 'aggregate', async (pipeline) => {
      assert.deepEqual(pipeline.find((stage) => stage.$sort).$sort, { contractEndSort: 1, createdAt: -1, _id: 1 })
      const ids = pipeline[0].$match._id.$in
      const offset = pipeline.find((stage) => stage.$skip !== undefined).$skip
      const limit = pipeline.find((stage) => stage.$limit).$limit
      assert.equal(offset, 0)
      return [...ids].reverse().slice(offset, offset + limit).map((id) => ({ _id: id }))
    })
    t.mock.method(Student, 'find', (filter) => queryResult(students.filter((student) => filter._id.$in.includes(student.id))))
    t.mock.method(StudentContract, 'find', (filter) => queryResult(filter.student.$in.map((id) => ({
      student: id, room: { roomNumber: '101', block: 'A', floor: '2' }, bedNumber: 3,
      createdAt: '2026-11-01', startDate: '2026-11-01', endDate: '2099-12-01',
    }))))
    let response
    await studentController.list({ query: {
      export: '1', page: '7',
      ...(scenario === 'filtered' ? {
        search: 'Talaba', university: objectId, faculty: objectId, course: '1,2', educationType: 'daytime',
        studentStatus: 'green', floor: '2', room: objectId, paymentStatus: 'fullyPaid',
        contractCreatedFrom: '2026-11-01', contractCreatedTo: '2026-11-25',
        contractEndFrom: '2099-12-01', contractEndTo: '2099-12-31',
      } : {}),
    } }, {
      status(code) { assert.equal(code, 200); return this }, json(body) { response = body.data },
    }, (error) => { throw error })
    const expectedIds = scenario === 'filtered' ? paidIds : matchingIds
    assert.deepEqual(response.students.map((student) => student.id), [...expectedIds].reverse())
    assert.equal(response.pagination.total, expectedIds.length)
    assert.equal(response.pagination.page, 1)
    assert.equal(response.pagination.totalPages, 1)
    if (response.students.length) {
      assert.equal(response.students[0].activeRoom.roomNumber, '101')
      assert.equal(response.students[0].activeBedNumber, 3)
      assert.equal(response.students[0].activeContractEndDate, '2099-12-01')
    }
  })
}

test('student workbook preserves every table field, all rows and text phone numbers in a real xlsx', async () => {
  const student = {
    fullName: 'G‘aniyev O‘tkir', photo: { url: 'https://example.com/photo.jpg' },
    activeRoom: { roomNumber: '001', block: 'A', floor: '2' }, activeBedNumber: 3,
    activeContractCreatedAt: '2026-11-01T10:30:00', activeContractStartDate: '2026-11-02', activeContractEndDate: '2026-12-01',
    currentPaymentStatus: 'late', currentPaymentDays: 4, currentPaymentLastPaidAt: '2026-11-05',
    studentStatus: 'warning', hasTaxContract: true, phone: '+998901234567', parentPhone: '001234567',
    university: { shortName: 'TATU', name: 'Universitet' }, faculty: { name: 'Informatika' }, course: 2,
    educationType: 'daytime', note: '=Muhim izoh\nIkkinchi qator',
  }
  const workbook = await createStudentsWorkbook(Array.from({ length: 31 }, () => student))
  const buffer = await workbook.xlsx.writeBuffer()
  const restored = new workbook.constructor()
  await restored.xlsx.load(buffer)
  const sheet = restored.getWorksheet('Talabalar')
  assert.equal(sheet.rowCount, 35)
  assert.equal(sheet.columnCount, 22)
  assert.deepEqual(sheet.getRow(5).values.slice(1), [
    1, student.fullName, student.photo.url, '001', 3, 'A', '2', '01.11.2026 10:30', '02.11.2026', '01.12.2026',
    'Yo‘q', '4 kun kechikkan', '05.11.2026', '50/50', 'Ha', '+998901234567', '001234567', 'TATU',
    'Informatika', 2, 'Kunduzgi', student.note,
  ])
  assert.equal(sheet.getCell('V5').type, 3) // Notes starting with '=' remain literal text.
  assert.equal(sheet.getCell('A35').value, 31)
  assert.equal(sheet.autoFilter, 'A4:V35')
  assert.equal(sheet.views[0].ySplit, 4)

  const empty = await createStudentsWorkbook([])
  const emptyBuffer = await empty.xlsx.writeBuffer()
  await restored.xlsx.load(emptyBuffer)
  assert.equal(restored.getWorksheet('Talabalar').rowCount, 4)
})

test('missing Excel values are blank cells rather than references to empty shared strings', async () => {
  const workbook = await createStudentsWorkbook([
    { fullName: 'Izohsiz talaba', note: '' },
    { fullName: 'Izohsiz talaba 2' },
    { fullName: 'Izohli talaba', note: '25' },
  ])
  const restored = new workbook.constructor()
  await restored.xlsx.load(await workbook.xlsx.writeBuffer())
  const sheet = restored.getWorksheet('Talabalar')
  for (const row of [5, 6]) {
    for (const column of ['C', 'P', 'Q', 'T', 'V']) {
      assert.equal(sheet.getCell(`${column}${row}`).value, null)
      assert.equal(sheet.getCell(`${column}${row}`).type, 0)
    }
  }
  // A real note containing 25 must remain text, rather than being erased.
  assert.equal(sheet.getCell('V7').value, '25')
  assert.equal(sheet.getCell('V7').type, 3)
})
