const DAY_MS = 86400000
export const recordId = (value) => String(value?._id ?? value?.id ?? value)
const day = (value) => Math.floor((new Date(value).getTime() + 5 * 3600000) / DAY_MS)
export const staysOverlap = (first, second) => day(first.startDate) <= day(second.endDate)
  && day(first.endDate) >= day(second.startDate)
export const hasLivingStudent = (contract) => contract.student && contract.student.isDeleted !== true
export const isActiveRoomStay = (contract, range) => hasLivingStudent(contract)
  && contract.status === 'active' && !contract.isDeleted && staysOverlap(contract, range)

export class RoomBedError extends Error {
  constructor(message, status = 409) {
    super(message)
    this.name = 'RoomBedError'
    this.status = status
  }
}

const byAssignmentDate = (a, b) => new Date(a.startDate) - new Date(b.startDate)
  || new Date(a.createdAt || a.startDate) - new Date(b.createdAt || b.startDate)
  || recordId(a).localeCompare(recordId(b))

// Existing numbers are permanent. Only unnumbered contracts receive the first
// bed available for their entire stay, in start-date/creation-date/id order.
export function assignLegacyBedNumbers(room, contracts) {
  const ordered = [...contracts].sort(byAssignmentDate)
  const assigned = []
  const assignments = []
  const title = `${room.roomNumber}-xona`
  for (const contract of ordered) {
    if (!Number.isFinite(day(contract.startDate)) || !Number.isFinite(day(contract.endDate))) {
      throw new RoomBedError(`${title}: shartnoma sanalari noto‘g‘ri`)
    }
    if (contract.bedNumber == null) continue
    if (!Number.isInteger(contract.bedNumber) || contract.bedNumber < 1 || contract.bedNumber > room.capacity) {
      throw new RoomBedError(`${title}: ${contract.bedNumber}-o‘rin xona sig‘imiga mos emas`)
    }
    if (assigned.some((other) => other.bedNumber === contract.bedNumber && staysOverlap(other, contract)
      && recordId(other.student) !== recordId(contract.student))) {
      throw new RoomBedError(`${title}: ${contract.bedNumber}-o‘ringa bir davrda bir nechta talaba biriktirilgan`)
    }
    assigned.push(contract)
  }
  for (const contract of ordered) {
    if (contract.bedNumber != null) continue
    const overlapping = assigned.filter((other) => staysOverlap(other, contract))
    const previousBed = overlapping.find((other) => recordId(other.student) === recordId(contract.student))?.bedNumber
    const continuingBed = overlapping.some((other) => other.bedNumber === previousBed
      && recordId(other.student) !== recordId(contract.student)) ? null : previousBed
    const bedNumber = continuingBed || Array.from({ length: room.capacity }, (_, i) => i + 1)
      .find((number) => !overlapping.some((other) => other.bedNumber === number))
    if (!bedNumber) throw new RoomBedError(`${title}: mavjud shartnomalar soni xona sig‘imidan oshgan, o‘rinlarni avtomatik raqamlab bo‘lmadi`)
    assigned.push({ ...contract, bedNumber })
    assignments.push({ contractId: recordId(contract), bedNumber })
  }
  const byId = new Map(assigned.map((contract) => [recordId(contract), contract]))
  return { contracts: ordered.map((contract) => byId.get(recordId(contract))), assignments }
}

export function roomBedState(room, contracts, range, excludeContractId = null) {
  const relevant = contracts.filter((contract) => isActiveRoomStay(contract, range)
    && recordId(contract) !== String(excludeContractId))
  const numbered = assignLegacyBedNumbers(room, relevant).contracts
  return Array.from({ length: room.capacity }, (_, index) => {
    const number = index + 1
    const occupants = numbered.filter((contract) => contract.bedNumber === number).map((contract) => ({
      contractId: recordId(contract), studentId: recordId(contract.student),
      fullName: contract.student.fullName || '', startDate: contract.startDate, endDate: contract.endDate,
    }))
    return { number, occupied: occupants.length > 0, available: !occupants.length && room.status === 'available', occupants }
  })
}
