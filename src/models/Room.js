import mongoose from 'mongoose'

const roomSchema = new mongoose.Schema(
  {
    roomNumber: { type: String, required: true, trim: true, unique: true, maxlength: 30 },
    block: { type: String, required: true, trim: true, maxlength: 80 },
    floor: { type: Number, required: true, min: 1 },
    capacity: { type: Number, required: true, min: 1, max: 50 },
    category: { type: String, enum: ['standart', 'komfort', 'premium', 'maxsus'], default: 'standart' },
    gender: { type: String, enum: ['male', 'female'], required: true },
    status: { type: String, enum: ['available', 'maintenance'], default: 'available' },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    images: {
      type: [{ url: { type: String, required: true }, displayUrl: { type: String, default: '' }, thumbnailUrl: { type: String, default: '' } }],
      default: [],
    },
  },
  { timestamps: true },
)

roomSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
    return result
  },
})

export const Room = mongoose.model('Room', roomSchema)
