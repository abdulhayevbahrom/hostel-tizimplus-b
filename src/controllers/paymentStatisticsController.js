import mongoose from 'mongoose'
import { ContractInstallment } from '../models/ContractInstallment.js'
import { Payment } from '../models/Payment.js'
import { StudentContract } from '../models/StudentContract.js'
import { ApiResponse } from '../utils/response.js'
import { paymentTimingStatus, periodKeyInTashkent } from '../utils/paymentTime.js'

const summaryOf = (rows) => {
  const summary = rows.reduce((result, row) => {
    result.studentCount += 1
    result.scheduledAmount += row.amount
    result.paidAmount += Math.min(row.amount, row.paidAmount)
    result.debtAmount += row.debtAmount
    result[row.debtAmount <= 0 ? 'paidCount' : 'remainingCount'] += 1
    result[`${row.paymentStatus}Count`] += 1
    return result
  }, { studentCount: 0, scheduledAmount: 0, paidAmount: 0, debtAmount: 0, paidCount: 0, remainingCount: 0, onTimeCount: 0, almostOnTimeCount: 0, lateCount: 0, pendingCount: 0 })
  const decided = summary.onTimeCount + summary.almostOnTimeCount + summary.lateCount
  summary.onTimeRate = decided ? Math.round((summary.onTimeCount / decided) * 100) : null
  summary.activity = decided ? (summary.onTimeRate >= 80 ? 'active' : summary.onTimeRate >= 50 ? 'attention' : 'lagging') : 'pending'
  return summary
}

const groupRows = (rows, keyFor, detailsFor) => {
  const groups = new Map()
  rows.forEach((row) => {
    const key = keyFor(row)
    if (!groups.has(key)) groups.set(key, { ...detailsFor(row), rows: [] })
    groups.get(key).rows.push(row)
  })
  return [...groups.values()].map(({ rows: groupItems, ...group }) => ({ ...group, ...summaryOf(groupItems) }))
    .sort((a, b) => (b.onTimeRate ?? -1) - (a.onTimeRate ?? -1) || b.onTimeCount - a.onTimeCount || a.lateCount - b.lateCount)
}

const groupFloorsFromRooms = (rooms) => {
  const groups = new Map()
  rooms.forEach((roomRow) => {
    const key = `${roomRow.room.block || ''}::${roomRow.room.floor}`
    if (!groups.has(key)) groups.set(key, { block: roomRow.room.block || '', floor: roomRow.room.floor, rooms: [] })
    groups.get(key).rooms.push(roomRow)
  })
  return [...groups.values()].map(({ rooms: floorRooms, ...floor }) => {
    const studentCount = floorRooms.reduce((total, room) => total + room.studentCount, 0)
    const paidRoomCount = floorRooms.filter((room) => room.debtAmount <= 0).length
    const remainingRoomCount = floorRooms.length - paidRoomCount
    const paidRoomRate = floorRooms.length ? Math.round((paidRoomCount / floorRooms.length) * 100) : null
    const lateRoomCount = floorRooms.filter((room) => room.lateCount > 0).length
    const almostOnTimeRoomCount = floorRooms.filter((room) => room.lateCount === 0 && room.almostOnTimeCount > 0).length
    const onTimeRoomCount = floorRooms.filter((room) => room.lateCount === 0 && room.almostOnTimeCount === 0 && room.onTimeCount > 0).length
    const pendingRoomCount = floorRooms.length - lateRoomCount - almostOnTimeRoomCount - onTimeRoomCount
    const timingDecided = onTimeRoomCount + almostOnTimeRoomCount + lateRoomCount
    const onTimeRoomRate = timingDecided ? Math.round((onTimeRoomCount / timingDecided) * 100) : null
    return { ...floor, roomCount: floorRooms.length, studentCount, paidRoomCount, remainingRoomCount, paidRoomRate, onTimeRoomCount, almostOnTimeRoomCount, lateRoomCount, pendingRoomCount, onTimeRoomRate }
  }).sort((a, b) => `${a.block} ${a.floor}`.localeCompare(`${b.block} ${b.floor}`, 'uz', { numeric: true, sensitivity: 'base' }))
}

class PaymentStatisticsController {
  room = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.roomId)) return ApiResponse.notFound(res, 'Xona topilmadi')
      const now = new Date()
      const period = /^\d{4}-\d{2}$/.test(String(req.query.period || '')) ? String(req.query.period) : periodKeyInTashkent(now)
      const contractIds = await StudentContract.distinct('_id', { room: req.params.roomId, status: { $ne: 'cancelled' } })
      const installments = await ContractInstallment.find({ periodKey: period, contract: { $in: contractIds } })
        .populate({ path: 'student', select: 'fullName phone photo' })
        .populate({ path: 'contract', select: 'contractNumber room', populate: { path: 'room', select: 'roomNumber block floor' } })
        .sort({ dueDate: 1 })
      const usable = installments.filter((item) => item.student && item.contract?.room)
      const payments = await Payment.find({ status: 'active', cancelledAt: null, 'allocations.installment': { $in: usable.map((item) => item._id) } }).select('allocations createdAt').sort({ createdAt: 1 })
      const allocations = new Map()
      payments.forEach((payment) => payment.allocations.forEach((allocation) => {
        const key = allocation.installment.toString()
        if (!allocations.has(key)) allocations.set(key, [])
        allocations.get(key).push({ amount: allocation.amount, paidAt: payment.createdAt })
      }))
      const students = usable.map((item) => {
        const allocated = allocations.get(item.id) || []
        const lastPaidAt = allocated.length ? allocated[allocated.length - 1].paidAt : null
        let paidAmount = 0
        let completedAt = null
        allocated.forEach((allocation) => { paidAmount += allocation.amount; if (!completedAt && paidAmount >= item.amount) completedAt = allocation.paidAt })
        paidAmount = Math.min(item.amount, Math.max(0, paidAmount))
        const paymentStatus = paymentTimingStatus({ dueDate: item.dueDate, completedAt: completedAt || item.updatedAt, isPaid: paidAmount >= item.amount, now })
        return { installmentId: item.id, student: item.student, contractId: item.contract.id, contractNumber: item.contract.contractNumber, room: item.contract.room, periodKey: item.periodKey, dueDate: item.dueDate, completedAt, lastPaidAt, amount: item.amount, paidAmount, debtAmount: Math.max(0, item.amount - paidAmount), paymentStatus }
      }).sort((a, b) => String(a.student.fullName || '').localeCompare(String(b.student.fullName || ''), 'uz', { sensitivity: 'base' }))
      return ApiResponse.ok(res, { period, students })
    } catch (error) { return next(error) }
  }

  list = async (req, res, next) => {
    try {
      const now = new Date()
      const period = /^\d{4}-\d{2}$/.test(String(req.query.period || '')) ? String(req.query.period) : periodKeyInTashkent(now)
      const contractIds = await StudentContract.distinct('_id', { status: { $ne: 'cancelled' } })
      const installments = await ContractInstallment.find({ periodKey: period, contract: { $in: contractIds } })
        .populate({ path: 'student', select: 'fullName phone photo' })
        .populate({ path: 'contract', select: 'contractNumber room', populate: { path: 'room', select: 'roomNumber block floor' } })
        .sort({ dueDate: 1 })

      const usable = installments.filter((item) => item.student && item.contract?.room)
      const installmentIds = usable.map((item) => item._id)
      const payments = await Payment.find({ status: 'active', cancelledAt: null, 'allocations.installment': { $in: installmentIds } })
        .select('allocations createdAt')
        .sort({ createdAt: 1 })

      const allocations = new Map()
      payments.forEach((payment) => payment.allocations.forEach((allocation) => {
        const key = allocation.installment.toString()
        if (!allocations.has(key)) allocations.set(key, [])
        allocations.get(key).push({ amount: allocation.amount, paidAt: payment.createdAt })
      }))

      const students = usable.map((item) => {
        const allocated = allocations.get(item.id) || []
        const lastPaidAt = allocated.length ? allocated[allocated.length - 1].paidAt : null
        let running = 0
        let completedAt = null
        allocated.forEach((allocation) => {
          running += allocation.amount
          if (!completedAt && running >= item.amount) completedAt = allocation.paidAt
        })
        const dueDate = new Date(item.dueDate)
        // The installment's cached paidAmount can be stale in legacy data.
        // Statistics must reflect only active, non-cancelled payment allocations.
        const paidAmount = Math.min(item.amount, Math.max(0, running))
        const isPaid = paidAmount >= item.amount
        const paymentStatus = paymentTimingStatus({ dueDate, completedAt: completedAt || item.updatedAt, isPaid, now })
        return {
          installmentId: item.id,
          student: item.student,
          contractId: item.contract.id,
          contractNumber: item.contract.contractNumber,
          room: item.contract.room,
          periodKey: item.periodKey,
          dueDate: item.dueDate,
          completedAt,
          lastPaidAt,
          amount: item.amount,
          paidAmount,
          debtAmount: Math.max(0, item.amount - paidAmount),
          paymentStatus,
        }
      })
      students.sort((a, b) => (
        String(a.room.block || '').localeCompare(String(b.room.block || ''), 'uz', { numeric: true, sensitivity: 'base' })
        || String(a.room.floor || '').localeCompare(String(b.room.floor || ''), 'uz', { numeric: true, sensitivity: 'base' })
        || String(a.room.roomNumber || '').localeCompare(String(b.room.roomNumber || ''), 'uz', { numeric: true, sensitivity: 'base' })
        || String(a.student.fullName || '').localeCompare(String(b.student.fullName || ''), 'uz', { sensitivity: 'base' })
      ))

      const rooms = groupRows(students, (row) => row.room.id, (row) => ({ room: row.room }))
      const floors = groupFloorsFromRooms(rooms)
      const search = String(req.query.search || '').trim().toLowerCase()
      const floor = String(req.query.floor || '').trim()
      const room = String(req.query.room || '').trim()
      const metric = req.query.metric === 'timing' ? 'timing' : 'payment'
      const status = String(req.query.status || 'all')
      const filteredStudents = students.filter((row) => {
        const matchesSearch = !search || `${row.student?.fullName || ''} ${row.student?.phone || ''} ${row.room?.roomNumber || ''} ${row.room?.block || ''} ${row.room?.floor || ''}`.toLowerCase().includes(search)
        const matchesLocation = (!floor || row.room?.floor === floor) && (!room || row.room?.id === room)
        const matchesStatus = status === 'all' || (metric === 'payment'
          ? (status === 'made' ? row.debtAmount <= 0 : status === 'notMade' ? row.debtAmount > 0 : true)
          : row.paymentStatus === status)
        return matchesSearch && matchesLocation && matchesStatus
      })
      const limit = 25
      const total = filteredStudents.length
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const page = Math.min(Math.max(1, Number.parseInt(req.query.page, 10) || 1), totalPages)
      const studentResults = filteredStudents.slice((page - 1) * limit, page * limit)
      return ApiResponse.ok(res, { period, summary: summaryOf(students), floors, rooms, studentResults, pagination: { page, limit, total, totalPages } })
    } catch (error) { return next(error) }
  }
}

export const paymentStatisticsController = new PaymentStatisticsController()
