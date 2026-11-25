import mongoose from 'mongoose'
import { Student } from '../models/Student.js'

// Resolve legacy student references without altering stored audit records or saved names.
export async function auditStudentNames(logs) {
  const rows = logs.map((log) => typeof log.toJSON === 'function' ? log.toJSON() : { ...log })
  const ids = new Set()
  const visit = (value, key = '', depth = 0) => {
    if (depth > 8 || value == null) return
    if (key === 'student' && typeof value === 'string' && mongoose.isValidObjectId(value)) ids.add(value)
    if (Array.isArray(value)) value.forEach((item) => visit(item, key, depth + 1))
    else if (typeof value === 'object') Object.entries(value).forEach(([childKey, item]) => visit(item, childKey, depth + 1))
  }
  rows.forEach((log) => { visit(log.oldValue); visit(log.newValue) })
  if (!ids.size) return rows
  const students = await Student.find({ _id: { $in: [...ids] } }).setOptions({ withDeleted: true }).select('fullName').lean()
  const names = new Map(students.map((student) => [String(student._id), student.fullName]))
  const resolve = (value, key = '', depth = 0) => {
    if (depth > 8 || value == null) return value
    if (key === 'student' && typeof value === 'string' && names.has(value)) return { id: value, fullName: names.get(value) }
    if (Array.isArray(value)) return value.map((item) => resolve(item, key, depth + 1))
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [childKey, resolve(item, childKey, depth + 1)]))
    return value
  }
  return rows.map((log) => ({ ...log, oldValue: resolve(log.oldValue), newValue: resolve(log.newValue) }))
}
