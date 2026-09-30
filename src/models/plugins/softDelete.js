export function softDeletePlugin(schema) {
  schema.add({
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: schema.base.Types.ObjectId, ref: 'Employee', default: null },
  })

  const excludeDeleted = function excludeDeleted(next) {
    const filter = this.getFilter()
    if (!this.getOptions().withDeleted && !Object.prototype.hasOwnProperty.call(filter, 'isDeleted')) this.where({ isDeleted: { $ne: true } })
    next()
  }
  ;['find', 'findOne', 'count', 'countDocuments', 'distinct', 'findOneAndUpdate', 'updateOne', 'updateMany'].forEach((operation) => schema.pre(operation, excludeDeleted))

  schema.pre('aggregate', function excludeDeletedAggregates(next) {
    const pipeline = this.pipeline()
    const match = { $match: { isDeleted: { $ne: true } } }
    if (pipeline[0]?.$geoNear) pipeline.splice(1, 0, match)
    else pipeline.unshift(match)
    next()
  })
}
