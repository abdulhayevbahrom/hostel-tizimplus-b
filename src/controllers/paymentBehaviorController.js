import { ContractInstallment } from '../models/ContractInstallment.js'
import { Payment } from '../models/Payment.js'
import { StudentContract } from '../models/StudentContract.js'
import { ApiResponse } from '../utils/response.js'
import { tashkentDayEnd } from '../utils/paymentTime.js'

const classify = (periods) => {
  return classifyCounts(periods.length, periods.filter((item) => item.status === 'onTime').length)
}

const classifyCounts = (evaluatedPeriods, onTimeCount) => {
  if (evaluatedPeriods < 3) return 'insufficient'
  const rate = Math.round((onTimeCount / evaluatedPeriods) * 100)
  if (rate === 100) return 'onTime'
  if (rate >= 80) return 'almostOnTime'
  return 'late'
}

const summarize = (rows) => {
  const result = { totalCount: rows.length, onTimeBehaviorCount: 0, almostOnTimeCount: 0, lateBehaviorCount: 0, insufficientCount: 0, evaluatedPeriods: 0, onTimeCount: 0, lateCount: 0 }
  rows.forEach((row) => {
    result.evaluatedPeriods += row.evaluatedPeriods
    result.onTimeCount += row.onTimeCount
    result.lateCount += row.lateCount
    if (row.behavior === 'onTime') result.onTimeBehaviorCount += 1
    else if (row.behavior === 'almostOnTime') result.almostOnTimeCount += 1
    else if (row.behavior === 'late') result.lateBehaviorCount += 1
    else result.insufficientCount += 1
  })
  result.onTimeRate = result.evaluatedPeriods ? Math.round((result.onTimeCount / result.evaluatedPeriods) * 100) : null
  return result
}

const group = (students, keyFor, detailsFor) => {
  const map = new Map()
  students.forEach((student) => {
    const key = keyFor(student)
    if (!map.has(key)) map.set(key, { ...detailsFor(student), students: [] })
    map.get(key).students.push(student)
  })
  return [...map.values()].map(({ students: rows, ...details }) => ({ ...details, studentCount: rows.length, ...summarize(rows) }))
}

const summarizeGroups = (rows) => {
  const result = { totalCount: rows.length, onTimeBehaviorCount: 0, almostOnTimeCount: 0, lateBehaviorCount: 0, insufficientCount: 0, evaluatedPeriods: 0, onTimeCount: 0, lateCount: 0 }
  rows.forEach((row) => {
    result.evaluatedPeriods += row.evaluatedPeriods
    result.onTimeCount += row.onTimeCount
    result.lateCount += row.lateCount
    if (row.behavior === 'onTime') result.onTimeBehaviorCount += 1
    else if (row.behavior === 'almostOnTime') result.almostOnTimeCount += 1
    else if (row.behavior === 'late') result.lateBehaviorCount += 1
    else result.insufficientCount += 1
  })
  result.onTimeRate = result.evaluatedPeriods ? Math.round((result.onTimeCount / result.evaluatedPeriods) * 100) : null
  return result
}

class PaymentBehaviorController {
  list = async (req, res, next) => {
    try {
      const todayEnd = tashkentDayEnd(new Date())
      const contractIds = await StudentContract.distinct('_id', { status: { $ne: 'cancelled' } })
      const installments = await ContractInstallment.find({ contract: { $in: contractIds }, dueDate: { $lte: todayEnd } })
        .populate({ path: 'student', select: 'fullName phone photo' })
        .populate({ path: 'contract', select: 'contractNumber room', populate: { path: 'room', select: 'roomNumber block floor' } })
        .sort({ dueDate: -1 })
      const usable = installments.filter((item) => item.student && item.contract?.room)
      const payments = await Payment.find({ status: 'active', cancelledAt: null, 'allocations.installment': { $in: usable.map((item) => item._id) } }).select('allocations createdAt').sort({ createdAt: 1 })
      const allocations = new Map()
      payments.forEach((payment) => payment.allocations.forEach((allocation) => {
        const key = allocation.installment.toString()
        if (!allocations.has(key)) allocations.set(key, [])
        allocations.get(key).push({ amount: allocation.amount, paidAt: payment.createdAt })
      }))
      const byStudent = new Map()
      usable.forEach((item) => {
        const key = item.student.id
        if (!byStudent.has(key)) byStudent.set(key, { student: item.student, room: item.contract.room, periods: [] })
        const entry = byStudent.get(key)
        if (entry.periods.length >= 6) return
        let running = 0
        let completedAt = null
        ;(allocations.get(item.id) || []).forEach((allocation) => { running += allocation.amount; if (!completedAt && running >= item.amount) completedAt = allocation.paidAt })
        const dueDayEnd = tashkentDayEnd(item.dueDate)
        const status = running >= item.amount && completedAt && completedAt <= dueDayEnd ? 'onTime' : 'late'
        entry.periods.push({ periodKey: item.periodKey, dueDate: item.dueDate, completedAt, amount: item.amount, paidAmount: Math.min(item.amount, running), debtAmount: Math.max(0, item.amount - running), status })
      })
      const students = [...byStudent.values()].map((entry) => {
        const onTimeCount = entry.periods.filter((item) => item.status === 'onTime').length
        const lateCount = entry.periods.length - onTimeCount
        return { ...entry, evaluatedPeriods: entry.periods.length, onTimeCount, lateCount, onTimeRate: entry.periods.length ? Math.round((onTimeCount / entry.periods.length) * 100) : null, behavior: classify(entry.periods) }
      }).sort((a, b) => String(a.room.floor).localeCompare(String(b.room.floor), 'uz', { numeric: true }) || String(a.room.roomNumber).localeCompare(String(b.room.roomNumber), 'uz', { numeric: true }) || a.student.fullName.localeCompare(b.student.fullName, 'uz'))
      const rooms = group(students, (row) => row.room.id, (row) => ({ room: row.room }))
        .map((room) => ({ ...room, behavior: classifyCounts(room.evaluatedPeriods, room.onTimeCount) }))
        .sort((a, b) => String(a.room.floor).localeCompare(String(b.room.floor), 'uz', { numeric: true }) || String(a.room.roomNumber).localeCompare(String(b.room.roomNumber), 'uz', { numeric: true }))
      const roomsByFloor = new Map()
      rooms.forEach((room) => {
        const key = `${room.room.block || ''}::${room.room.floor}`
        if (!roomsByFloor.has(key)) roomsByFloor.set(key, [])
        roomsByFloor.get(key).push(room)
      })
      const floors = group(students, (row) => `${row.room.block || ''}::${row.room.floor}`, (row) => ({ block: row.room.block || '', floor: row.room.floor }))
        .map((floor) => {
          const floorRooms = roomsByFloor.get(`${floor.block}::${floor.floor}`) || []
          const roomSummary = summarizeGroups(floorRooms)
          return {
            ...floor,
            roomCount: floorRooms.length,
            roomBehavior: roomSummary,
          }
        })
        .sort((a, b) => `${a.block} ${a.floor}`.localeCompare(`${b.block} ${b.floor}`, 'uz', { numeric: true }))
      const search = String(req.query.search || '').trim().toLowerCase()
      const floor = String(req.query.floor || '').trim()
      const room = String(req.query.room || '').trim()
      const status = String(req.query.status || 'all')
      const filtered = students.filter((row) => (!search || `${row.student.fullName} ${row.student.phone || ''} ${row.room.roomNumber} ${row.room.floor}`.toLowerCase().includes(search)) && (!floor || row.room.floor === floor) && (!room || row.room.id === room) && (status === 'all' || row.behavior === status))
      const limit = 25
      const total = filtered.length
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const page = Math.min(Math.max(1, Number.parseInt(req.query.page, 10) || 1), totalPages)
      return ApiResponse.ok(res, { summary: summarize(students), floors, rooms, studentResults: filtered.slice((page - 1) * limit, page * limit), pagination: { page, limit, total, totalPages } })
    } catch (error) { return next(error) }
  }
}

export const paymentBehaviorController = new PaymentBehaviorController()
