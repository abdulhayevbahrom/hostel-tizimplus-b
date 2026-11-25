import test from 'node:test'
import assert from 'node:assert/strict'
import { deadlineAuditChanges } from '../../frontend/src/utils/deadlineAudit.js'
import { auditStudentNames } from '../src/utils/auditStudentNames.js'
import { auditMutation } from '../src/middleware/audit.js'
import { Student } from '../src/models/Student.js'
import { DebtorDeadline } from '../src/models/DebtorDeadline.js'
import { AuditLog } from '../src/models/AuditLog.js'

const student = '6ad7960a9dc576031fa78b2a'
const deadlineId = '6ad7960a9dc576031fa78b2b'

test('deadline history formats local dates, resolves names and omits setBy metadata', () => {
  const changes = deadlineAuditChanges({}, { student: { id: student, fullName: 'Test Talaba' }, periodKey: '2026-11',
    deadline: '2026-11-29T18:59:59.999Z', setBy: { firstname: 'Owner' } })
  assert.deepEqual(changes.map((row) => row.key), ['student', 'periodKey', 'deadline'])
  assert.equal(changes[0].after, 'Test Talaba')
  assert.equal(changes[2].after, '29.11.2026')
  const before = { student, periodKey: '2026-11', deadline: '2026-11-29T18:59:59.999Z' }
  assert.deepEqual(deadlineAuditChanges(before, { ...before, student: { id: student, fullName: 'Test Talaba' },
    deadline: '2026-12-01T18:59:59.999Z' }).map((row) => [row.before, row.after]), [['29.11.2026', '01.12.2026']])
})

test('legacy deadline logs resolve student names without rewriting stored snapshots', async (t) => {
  const logs = [{ entityType: 'debtor-deadline', oldValue: null, newValue: { deadline: { student, periodKey: '2026-11' } } }]
  t.mock.method(Student, 'find', () => ({ setOptions() { return this }, select() { return this },
    lean: async () => [{ _id: student, fullName: 'Test Talaba' }] }))
  const result = await auditStudentNames(logs)
  assert.equal(result[0].newValue.deadline.student.fullName, 'Test Talaba')
  assert.equal(logs[0].newValue.deadline.student, student)
})

test('created contract audit resolves student ids and preserves historical saved names', async (t) => {
  const logs = [{ entityType: 'contract', action: 'create', newValue: { contract: {
    student, contractNumber: 'SHARTNOMA-2026-11', depositEnabled: false,
  } } }, { entityType: 'contract', newValue: { contract: { student: { id: student, fullName: 'Avvalgi ism' } } } }]
  t.mock.method(Student, 'find', (filter) => {
    assert.deepEqual(filter, { _id: { $in: [student] } })
    return { setOptions() { return this }, select() { return this }, lean: async () => [{ _id: student, fullName: 'Test Talaba' }] }
  })
  const result = await auditStudentNames(logs)
  assert.equal(result[0].newValue.contract.student.fullName, 'Test Talaba')
  assert.equal(result[0].newValue.contract.depositEnabled, false)
  assert.equal(result[1].newValue.contract.student.fullName, 'Avvalgi ism')
  assert.equal(logs[0].newValue.contract.student, student)
})

test('deadline auditing looks up the previous deadline by student and month, not by student as deadline id', async (t) => {
  const oldValue = { _id: deadlineId, student, periodKey: '2026-11', deadline: new Date('2026-11-28T18:59:59.999Z') }
  t.mock.method(DebtorDeadline, 'findOne', (filter) => {
    assert.deepEqual(filter, { student, periodKey: '2026-11' })
    return { populate() { return this }, lean: async () => oldValue }
  })
  t.mock.method(DebtorDeadline, 'findById', () => { throw Error('Wrong lookup') })
  let saved
  t.mock.method(AuditLog, 'create', async (value) => { saved = value; return { ...value, id: 'audit-1' } })
  let finish
  const req = { method: 'PUT', path: `/api/debtors/${student}/deadline`, originalUrl: `/api/debtors/${student}/deadline`,
    body: { periodKey: '2026-11' }, employee: { _id: student, firstname: 'Test', lastname: 'Admin' },
    get() {}, app: { get: () => ({ emit() {} }) } }
  const res = { statusCode: 200, json(body) { return body }, on(_, callback) { finish = callback } }
  await auditMutation(req, res, () => {})
  res.json({ data: { deadline: { id: deadlineId, student, periodKey: '2026-11', deadline: '2026-11-29T18:59:59.999Z' } } })
  finish()
  assert.equal(saved.oldValue.deadline, '2026-11-28T18:59:59.999Z')
  assert.equal(saved.entityId, deadlineId)
  assert.equal(saved.action, 'deadline')
})
