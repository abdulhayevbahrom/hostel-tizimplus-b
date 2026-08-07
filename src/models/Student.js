import mongoose from 'mongoose'

const photoSchema = new mongoose.Schema(
  { url: String, displayUrl: String, thumbnailUrl: String },
  { _id: false },
)

const studentSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 150 },
    phone: { type: String, required: true, trim: true, match: /^\d{9}$/ },
    gender: { type: String, enum: ['male', 'female'], required: true },
    parentPhone: { type: String, trim: true, default: '', validate: { validator: (value) => !value || /^\d{9}$/.test(value), message: 'Ota-ona telefoni 9 ta raqamdan iborat bo‘lishi kerak' } },
    university: { type: mongoose.Schema.Types.ObjectId, ref: 'University', required: true, index: true },
    faculty: { type: mongoose.Schema.Types.ObjectId, ref: 'Faculty', required: true, index: true },
    address: { type: String, trim: true, maxlength: 300, default: '' },
    course: { type: Number, required: true, min: 1, max: 6 },
    studentStatus: { type: String, enum: ['green', 'warning', 'red'], default: 'green', index: true },
    hasTaxContract: { type: Boolean, default: false, index: true },
    disciplinaryStatus: { type: String, enum: ['clear', 'monitoring', 'blacklisted'], default: 'clear' },
    disciplinaryNote: { type: String, trim: true, maxlength: 1000, default: '' },
    disabilityStatus: { type: String, enum: ['none', 'has_disability'], default: 'none' },
    photo: { type: photoSchema, default: null },
    jshr: { type: String, trim: true, match: /^\d{14}$/ },
    passportSeries: { type: String, trim: true, uppercase: true, match: /^[A-Z]{2}$/ },
    passportNumber: { type: String, trim: true, match: /^\d{7}$/ },
  },
  { timestamps: true },
)

studentSchema.index({ jshr: 1 }, { unique: true, partialFilterExpression: { jshr: { $type: 'string' } } })
studentSchema.index(
  { passportSeries: 1, passportNumber: 1 },
  { unique: true, partialFilterExpression: { passportSeries: { $type: 'string' }, passportNumber: { $type: 'string' } } },
)
studentSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const Student = mongoose.model('Student', studentSchema)
