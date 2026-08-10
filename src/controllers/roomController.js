import mongoose from 'mongoose'
import { BuildingBlock } from '../models/BuildingBlock.js'
import { Room } from '../models/Room.js'
import { StudentContract } from '../models/StudentContract.js'
import { ApiResponse } from '../utils/response.js'
import { uploadImages } from '../utils/imgbb.js'

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
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const todayEnd = new Date(todayStart)
      todayEnd.setDate(todayEnd.getDate() + 1)
      const roomDocuments = await Room.find().sort({ block: 1, roomNumber: 1 })
      roomDocuments.sort((first, second) => (
        first.block.localeCompare(second.block, undefined, { numeric: true })
        || first.floor.localeCompare(second.floor, undefined, { numeric: true })
        || first.roomNumber.localeCompare(second.roomNumber, undefined, { numeric: true })
      ))
      const occupied = await StudentContract.aggregate([{ $match: { status: 'active', startDate: { $lt: todayEnd }, endDate: { $gte: todayStart } } }, { $group: { _id: '$room', count: { $sum: 1 } } }])
      const occupiedByRoom = new Map(occupied.map((item) => [item._id.toString(), item.count]))
      const rooms = roomDocuments.map((room) => ({ ...room.toJSON(), occupiedCount: occupiedByRoom.get(room.id) || 0 }))
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
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const todayEnd = new Date(todayStart)
      todayEnd.setDate(todayEnd.getDate() + 1)
      const contracts = await StudentContract.find({ room: room._id, status: 'active', startDate: { $lt: todayEnd }, endDate: { $gte: todayStart } })
        .populate({ path: 'student', select: 'fullName phone parentPhone photo university faculty course gender', populate: [{ path: 'university', select: 'name' }, { path: 'faculty', select: 'name' }] })
        .sort({ startDate: 1 })
      const students = contracts.filter((item) => item.student).map((contract) => ({ student: contract.student, contract: { id: contract.id, contractNumber: contract.contractNumber, startDate: contract.startDate, endDate: contract.endDate, paymentType: contract.paymentType, paymentAmount: contract.paymentAmount } }))
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
      const uploadedImages = await uploadImages(req.files)
      room.set({ ...payload, images: [...payload.images, ...uploadedImages] })
      await room.save()
      this.emitChange(req, 'updated', room)
      return ApiResponse.ok(res, { room }, 'Xona yangilandi')
    } catch (error) { return next(error) }
  }

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Xona topilmadi')
      const room = await Room.findById(req.params.id)
      if (!room) return ApiResponse.notFound(res, 'Xona topilmadi')
      await room.deleteOne()
      this.emitChange(req, 'deleted', room)
      return ApiResponse.ok(res, { roomId: room.id }, 'Xona o‘chirildi')
    } catch (error) { return next(error) }
  }
}

export const roomController = new RoomController()
