import mongoose from 'mongoose'
import { BuildingBlock } from '../models/BuildingBlock.js'
import { ContractInstallment } from '../models/ContractInstallment.js'
import { Room } from '../models/Room.js'
import { StudentContract } from '../models/StudentContract.js'
import { lockRooms, loadRoomBedContracts } from '../services/roomBeds.js'
import { recordId, RoomBedError, roomBedState } from '../utils/roomBeds.js'
import { parsePaymentDate, tashkentDayEnd, tashkentDayStart } from '../utils/paymentTime.js'
import { ApiResponse } from '../utils/response.js'
import { deleteImages, uploadImages } from '../utils/imgbb.js'

const occupancyPeriod = (period) => {
  const value = String(period || '')
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) {
    const start = tashkentDayStart()
    const end = new Date(start.getTime() + 86400000)
    return { start, end }
  }

  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - 5 * 3600000),
    end: new Date(Date.UTC(year, month, 1) - 5 * 3600000),
  }
}

const bedRange = (query) => {
  if (query.startDate || query.endDate) {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(query.startDate)) ? parsePaymentDate(query.startDate) : null
    const end = /^\d{4}-\d{2}-\d{2}$/.test(String(query.endDate)) ? parsePaymentDate(query.endDate) : null
    if (!start || !end || end < start) throw new RoomBedError('Boshlanish va tugash sanalarini to‘g‘ri tanlang', 400)
    return { startDate: start, endDate: end }
  }
  const period = occupancyPeriod(query.period)
  if (!period) throw new RoomBedError('Oy YYYY-MM formatida bo‘lishi kerak', 400)
  return { startDate: period.start, endDate: new Date(period.end.getTime() - 1) }
}

class RoomController {
  cleanPayload(body) {
    return {
      roomNumber: String(body.roomNumber || '').trim(),
      block: String(body.block || '').trim(),
      floor: String(body.floor ?? '').trim(),
      capacity: Number(body.capacity),
      category: body.category || '',
      gender: body.gender,
      status: body.status || 'available',
      note: String(body.note || '').trim(),
      images: Array.isArray(body.images) ? body.images : [],
    }
  }

  emitChange(req, action, room) {
    req.app.get('io')?.emit('rooms:changed', { action, roomId: room?.id || room?._id?.toString(), occurredAt: new Date().toISOString() })
  }

  list = async (req, res, next) => {
    try {
      const range = bedRange(req.query)
      const roomDocuments = await Room.find().sort({ block: 1, roomNumber: 1 })
      roomDocuments.sort((first, second) => (
        first.block.localeCompare(second.block, undefined, { numeric: true })
        || first.floor.localeCompare(second.floor, undefined, { numeric: true })
        || first.roomNumber.localeCompare(second.roomNumber, undefined, { numeric: true })
      ))
      const contracts = await StudentContract.find({ room: { $in: roomDocuments.map((room) => room._id) },
        status: { $ne: 'cancelled' }, startDate: { $lte: tashkentDayEnd(range.endDate) },
        endDate: { $gte: tashkentDayStart(range.startDate) } })
        .select('student room bedNumber startDate endDate status createdAt')
        .populate({ path: 'student', select: 'fullName isDeleted' }).lean()
      const byRoom = new Map()
      for (const contract of contracts) {
        const key = recordId(contract.room)
        if (!byRoom.has(key)) byRoom.set(key, [])
        byRoom.get(key).push(contract)
      }
      const rooms = roomDocuments.map((room) => {
        try {
          const beds = roomBedState(room, byRoom.get(room.id) || [], range, req.query.excludeContractId)
          return { ...room.toJSON(), beds, occupiedCount: beds.filter((bed) => bed.occupied).length,
            availableBeds: beds.filter((bed) => bed.available).map((bed) => bed.number) }
        } catch (error) {
          if (!(error instanceof RoomBedError)) throw error
          // Keep the room accessible for correcting legacy contracts, but never
          // advertise free beds when their allocation could not be verified.
          return { ...room.toJSON(), beds: [], occupiedCount: null, availableBeds: [], bedAllocationError: error.message }
        }
      })
      const summary = rooms.reduce((result, room) => {
        result.totalRooms += 1
        result.totalBeds += room.capacity
        if (room.gender === 'male') result.maleRooms += 1
        if (room.gender === 'female') result.femaleRooms += 1
        if (room.status === 'maintenance') result.maintenanceRooms += 1
        return result
      }, { totalRooms: 0, totalBeds: 0, maleRooms: 0, femaleRooms: 0, maintenanceRooms: 0 })
      return ApiResponse.ok(res, { rooms, summary })
    } catch (error) { return next(error) }
  }

  beds = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Xona topilmadi')
      const room = await Room.findById(req.params.id)
      if (!room) return ApiResponse.notFound(res, 'Xona topilmadi')
      const range = bedRange(req.query)
      const beds = roomBedState(room, await loadRoomBedContracts(room._id), range, req.query.excludeContractId)
      return ApiResponse.ok(res, { room, beds, availableBeds: beds.filter((bed) => bed.available).map((bed) => bed.number) })
    } catch (error) { return next(error) }
  }

  getById = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Xona topilmadi')
      const room = await Room.findById(req.params.id)
      if (!room) return ApiResponse.notFound(res, 'Xona topilmadi')
      return ApiResponse.ok(res, { room })
    } catch (error) { return next(error) }
  }

  students = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Xona topilmadi')
      const room = await Room.findById(req.params.id)
      if (!room) return ApiResponse.notFound(res, 'Xona topilmadi')
      const period = occupancyPeriod(req.query.period)
      if (!period) return ApiResponse.badRequest(res, 'Oy YYYY-MM formatida bo‘lishi kerak')
      const contracts = await StudentContract.find({ room: room._id, status: { $ne: 'cancelled' }, startDate: { $lt: period.end }, endDate: { $gte: period.start } })
        .populate({ path: 'student', select: 'fullName phone parentPhone photo university faculty course gender educationType', populate: [{ path: 'university', select: 'name' }, { path: 'faculty', select: 'name' }] })
        .sort({ bedNumber: 1, startDate: 1 })
      const contractIds = contracts.map((contract) => contract._id)
      const contractInstallments = await ContractInstallment.find({ contract: { $in: contractIds } })
        .select('contract periodKey dueDate amount paidAmount status periodIndex')
        .sort({ periodIndex: 1, dueDate: 1 })
        .lean()
      const installmentsByContract = new Map()
      for (const installment of contractInstallments) {
        if (Number(installment.paidAmount || 0) <= 0) continue
        const key = installment.contract.toString()
        if (!installmentsByContract.has(key)) installmentsByContract.set(key, [])
        installmentsByContract.get(key).push({
          id: installment._id.toString(),
          periodKey: installment.periodKey,
          dueDate: installment.dueDate,
          amount: installment.amount,
          paidAmount: installment.paidAmount,
          remainingAmount: Math.max(0, installment.amount - installment.paidAmount),
          status: installment.status,
        })
      }
      const students = contracts.filter((item) => item.student).map((contract) => {
        return {
          student: contract.student,
          contract: { id: contract.id, bedNumber: contract.bedNumber, contractNumber: contract.contractNumber, startDate: contract.startDate, endDate: contract.endDate, paymentType: contract.paymentType, paymentAmount: contract.paymentAmount },
          installments: installmentsByContract.get(contract._id.toString()) || [],
        }
      })
      return ApiResponse.ok(res, { room, students, occupiedCount: students.length, availableCount: Math.max(0, room.capacity - students.length) })
    } catch (error) { return next(error) }
  }

  create = async (req, res, next) => {
    try {
      const payload = this.cleanPayload(req.body)
      if (payload.block && !(await BuildingBlock.exists({ name: payload.block }))) return ApiResponse.badRequest(res, 'Bino yoki blokni sozlamalardan tanlang')
      if ((req.files?.length || 0) > 8) return ApiResponse.badRequest(res, 'Eng ko‘pi 8 ta rasm yuklash mumkin')
      payload.images = await uploadImages(req.files)
      const room = await Room.create(payload)
      this.emitChange(req, 'created', room)
      return ApiResponse.created(res, { room }, 'Xona qo‘shildi')
    } catch (error) { return next(error) }
  }

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Xona topilmadi')
      const room = await Room.findById(req.params.id)
      if (!room) return ApiResponse.notFound(res, 'Xona topilmadi')
      const payload = this.cleanPayload(req.body)
      if (payload.block && !(await BuildingBlock.exists({ name: payload.block }))) return ApiResponse.badRequest(res, 'Bino yoki blokni sozlamalardan tanlang')
      if (payload.images.length + (req.files?.length || 0) > 8) return ApiResponse.badRequest(res, 'Eng ko‘pi 8 ta rasm saqlash mumkin')
      const currentImages = room.images.map((image) => image.toObject())
      const currentByUrl = new Map(currentImages.map((image) => [image.url, image]))
      const retainedImages = payload.images.map((image) => currentByUrl.get(image.url)).filter(Boolean)
      const retainedUrls = new Set(retainedImages.map((image) => image.url))
      const removedImages = currentImages.filter((image) => !retainedUrls.has(image.url))
      const uploadedImages = await uploadImages(req.files)
      await mongoose.connection.transaction(async (session) => {
        const locked = (await lockRooms([room._id], session)).get(room.id)
        const residents = (await loadRoomBedContracts(room._id, session))
          .filter((contract) => contract.status === 'active' && contract.student && !contract.student.isDeleted)
        if (residents.some((contract) => contract.bedNumber > payload.capacity)) {
          throw new RoomBedError('Xona sig‘imini band o‘rin raqamidan kichraytirib bo‘lmaydi')
        }
        locked.set({ ...payload, images: [...retainedImages, ...uploadedImages] })
        await locked.save({ session })
        room.set(locked.toObject())
      })
      await deleteImages(removedImages)
      this.emitChange(req, 'updated', room)
      return ApiResponse.ok(res, { room }, 'Xona yangilandi')
    } catch (error) { return next(error) }
  }

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Xona topilmadi')
      const room = await Room.findById(req.params.id)
      if (!room) return ApiResponse.notFound(res, 'Xona topilmadi')
      room.set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.employee._id })
      await room.save()
      this.emitChange(req, 'deleted', room)
      return ApiResponse.ok(res, { room }, 'Xona o‘chirildi')
    } catch (error) { return next(error) }
  }
}

export const roomController = new RoomController()
