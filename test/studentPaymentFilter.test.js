import assert from 'node:assert/strict'
import test from 'node:test'
import { studentController } from '../src/controllers/studentController.js'
import { Student } from '../src/models/Student.js'
import { StudentContract } from '../src/models/StudentContract.js'
import { ContractInstallment } from '../src/models/ContractInstallment.js'
import { Payment } from '../src/models/Payment.js'

const queryResult = (value) => ({
  select() { return this },
  sort() { return this },
  lean() { return Promise.resolve(value) },
  populate() { return this },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject) },
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
  t.mock.method(Student, 'distinct', async () => students.map((student) => student.id))
  t.mock.method(StudentContract, 'distinct', async () => [])
  t.mock.method(StudentContract, 'find', () => queryResult([]))
  t.mock.method(ContractInstallment, 'find', () => queryResult(installments))
  t.mock.method(Payment, 'find', () => queryResult([
    { paymentDate: '2000-02-01', allocations: students.slice(0, 26).map((student) => ({ installment: `paid-${student.id}`, amount: 100 })) },
    { paymentDate: '2000-02-01', allocations: [{ installment: 'late', amount: 25 }] },
    { paymentDate: '2000-02-03', allocations: [{ installment: 'late', amount: 25 }] },
  ]))
  let receivedFilter
  t.mock.method(Student, 'find', (filter) => {
    receivedFilter = filter
    const selectedIds = filter.$and?.find((part) => part._id?.$in)?._id.$in
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
    assert.equal(receivedFilter.studentStatus, 'green')
    for (const student of response.students) {
      const expectedDueDate = student.id === '28' ? null : student.id === '27' ? '2100-01-01' : '2000-01-01'
      assert.equal(student.currentPaymentDueDate, expectedDueDate)
      const expectedLastPaidAt = ['27', '28'].includes(student.id) ? null : student.id === '26' ? '2000-02-03' : '2000-02-01'
      assert.equal(student.currentPaymentLastPaidAt, expectedLastPaidAt)
    }
  }
})
