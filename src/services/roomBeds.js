import mongoose from 'mongoose'
import { Room } from '../models/Room.js'
import { Student } from '../models/Student.js'
import { StudentContract } from '../models/StudentContract.js'
import { assignLegacyBedNumbers, hasLivingStudent, recordId, RoomBedError, roomBedState } from '../utils/roomBeds.js'

export async function loadRoomBedContracts(roomId, session = null) {
  return StudentContract.find({ room: roomId, status: { $ne: 'cancelled' } })
    .select('student room bedNumber startDate endDate status createdAt')
    .populate({ path: 'student', select: 'fullName isDeleted' }).session(session).lean()
}

// A write to the room serializes concurrent booking, move and capacity changes.
// MongoDB retries a conflicting transaction against the newly committed state.
export async function lockRooms(roomIds, session) {
  const rooms = new Map()
  for (const id of [...new Set(roomIds.map(recordId))].sort()) {
    if (!mongoose.isValidObjectId(id)) throw new RoomBedError('Xonani tanlang', 400)
    const room = await Room.findOneAndUpdate({ _id: id }, { $inc: { bookingVersion: 1 } }, { new: true, session })
    if (!room) throw new RoomBedError('Xona topilmadi', 404)
    rooms.set(id, room)
  }
  return rooms
}

export async function reserveRoomBed(payload, session, { newStudent = null, excludeContractId = null, previousRoom = null } = {}) {
  const rooms = await lockRooms([payload.room, ...(previousRoom ? [previousRoom] : [])], session)
  const room = rooms.get(recordId(payload.room))
  const student = newStudent || await Student.findById(payload.student).session(session)
  if (!student || student.isDeleted) throw new RoomBedError('Talabani to‘g‘ri tanlang', 400)
  if (room.gender !== student.gender) throw new RoomBedError('Xona talabaning jinsiga mos emas', 400)
  if (payload.status === 'cancelled') return room
  if (!Number.isInteger(payload.bedNumber) || payload.bedNumber < 1 || payload.bedNumber > room.capacity) {
    throw new RoomBedError(`1 dan ${room.capacity} gacha bo‘lgan o‘rinni tanlang`, 400)
  }
  if (room.status === 'maintenance') throw new RoomBedError('Ta’mirdagi xonaga talaba biriktirib bo‘lmaydi', 400)
  if (payload.status === 'active' && await StudentContract.exists({ student: student._id, status: 'active',
    ...(excludeContractId ? { _id: { $ne: excludeContractId } } : {}) }).session(session)) {
    throw new RoomBedError('Talabaning boshqa aktiv shartnomasi mavjud')
  }
  const beds = roomBedState(room, await loadRoomBedContracts(room._id, session), payload, excludeContractId)
  if (!beds[payload.bedNumber - 1].available) {
    throw new RoomBedError(`${payload.bedNumber}-o‘rin tanlangan sanalarda band. Boshqa bo‘sh o‘rinni tanlang`)
  }
  return room
}

export async function migrateLegacyRoomBeds({ dryRun = true, skipConflicts = false } = {}) {
  const run = async (session = null) => {
    const rooms = await Room.find().sort({ _id: 1 }).session(session).lean()
    const report = []
    const conflicts = []
    for (const original of rooms) {
      const contracts = (await loadRoomBedContracts(original._id, session))
        .filter((contract) => contract.status === 'active' && hasLivingStudent(contract))
      let plan
      try {
        plan = assignLegacyBedNumbers(original, contracts)
      } catch (error) {
        if (!skipConflicts || !(error instanceof RoomBedError)) throw error
        conflicts.push({ roomId: recordId(original), roomNumber: original.roomNumber, block: original.block, message: error.message })
        continue
      }
      const { assignments } = plan
      if (!assignments.length) continue
      const room = session ? (await lockRooms([original._id], session)).get(recordId(original)) : original
      if (session) await StudentContract.bulkWrite(assignments.map(({ contractId, bedNumber }) => ({
        updateOne: { filter: { _id: new mongoose.Types.ObjectId(contractId), bedNumber: null },
          update: { $set: { bedNumber } }, timestamps: false },
      })), { session })
      report.push({ roomId: recordId(room), roomNumber: room.roomNumber, block: room.block,
        assignments })
    }
    return { dryRun, assignedContracts: report.reduce((sum, row) => sum + row.assignments.length, 0), rooms: report, conflicts }
  }
  return dryRun ? run() : mongoose.connection.transaction((session) => run(session))
}
