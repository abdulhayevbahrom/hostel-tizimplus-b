import test from 'node:test'
import assert from 'node:assert/strict'
import { paymentAuditChanges } from '../../frontend/src/utils/paymentAudit.js'

const before = { amount: 500000, method: 'cash', fundHolder: 'cashier',
  paymentDate: '2026-11-25T10:00:00Z', note: '', allocations: [{ installment: 'installment-1', amount: 500000 }] }

test('payment audit ignores populated references, metadata and equivalent legacy payment parts', () => {
  const after = { ...before, student: { id: 's1', fullName: 'Talaba' },
    contract: { id: 'c1', contractNumber: 'TEST-1' }, receivedBy: { id: 'e1', firstname: 'Admin' },
    allocations: [{ installment: { id: 'installment-1', periodKey: '2027-06', paidAmount: 500000 }, amount: 500000 }],
    paymentParts: [{ method: 'cash', amount: 500000, fundHolder: 'cashier' }],
    paymentDate: '2026-11-25T15:00:00+05:00', status: 'active', auditHistory: [{ action: 'updated' }] }
  assert.deepEqual(paymentAuditChanges(before, after), [])
})

test('payment audit lists only actual edits and formats dates in Tashkent time', () => {
  const changes = paymentAuditChanges(before, { ...before, note: 'Tuzatildi', paymentDate: '2026-11-25T11:30:00Z' })
  assert.deepEqual(changes.map((row) => row.key), ['paymentDate', 'note'])
  assert.ok(changes[0].after.includes('16:30'))
  assert.equal(changes[1].before, '—')
  assert.equal(changes[1].after, 'Tuzatildi')
})

test('payment history shows a changed payment month and money without exposing database ids', () => {
  const changes = paymentAuditChanges({ ...before, paymentPeriod: '2027-06' },
    { ...before, amount: 400000, paymentPeriod: '2027-07' })
  const month = changes.find((row) => row.key === 'paymentPeriod')
  assert.equal(month.before, '2027-06')
  assert.equal(month.after, '2027-07')
  assert.ok(changes.find((row) => row.key === 'amount').after.endsWith('so‘m'))
  const legacy = paymentAuditChanges(before, { ...before, allocations: [{ installment: { id: 'installment-2', periodKey: '2027-07' } }] })
  assert.equal(legacy[0].before, 'Davr nomi saqlanmagan')
  assert.equal(legacy[0].after, '2027-07')
})

test('reordered split payments do not create false edits but fund holder changes are shown', () => {
  const paymentParts = [{ method: 'cash', amount: 200000, fundHolder: 'cashier' }, { method: 'card', amount: 300000, fundHolder: 'organization' }]
  const payment = { ...before, paymentParts }
  assert.deepEqual(paymentAuditChanges(payment, { ...payment, paymentParts: [...paymentParts].reverse() }), [])
  const changes = paymentAuditChanges(payment, { ...payment, paymentParts: [{ ...paymentParts[0], fundHolder: 'organization' }, paymentParts[1]] })
  assert.equal(changes.length, 1)
  assert.ok(changes[0].before.includes('Kassir hisobida'))
  assert.ok(changes[0].after.includes('Tashkilot hisobida'))
})
