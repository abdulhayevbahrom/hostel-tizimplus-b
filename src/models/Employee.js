import mongoose from 'mongoose'

const employeeSchema = new mongoose.Schema(
  {
    firstname: { type: String, required: true, trim: true, maxlength: 60 },
    lastname: { type: String, required: true, trim: true, maxlength: 60 },
    position: { type: String, required: true, trim: true, maxlength: 100 },
    salary: { type: Number, default: 0, min: 0 },
    payrollStartMonth: {
      type: String,
      match: /^\d{4}-(0[1-9]|1[0-2])$/,
      default: () => new Date().toISOString().slice(0, 7),
    },
    payrollOpeningBalance: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    canLogin: { type: Boolean, default: false },
    role: {
      type: String,
      enum: ['employee', 'manager', 'cashier', 'owner', 'admin'],
      default: 'employee',
    },
    login: {
      type: String,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 60,
      sparse: true,
      unique: true,
    },
    sections: [{ type: String, trim: true }],
    assignedRooms: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Room' }],
    passwordHash: { type: String, select: false, default: null },
  },
  { timestamps: true },
)

employeeSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
    delete result.passwordHash
    return result
  },
})

employeeSchema.virtual('fullName').get(function fullName() {
  return `${this.firstname} ${this.lastname}`.trim()
})

export const Employee = mongoose.model('Employee', employeeSchema)
