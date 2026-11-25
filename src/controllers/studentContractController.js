import mongoose from "mongoose";
import { Student } from "../models/Student.js";
import { StudentContract } from "../models/StudentContract.js";
import { ContractInstallment } from "../models/ContractInstallment.js";
import { Payment } from "../models/Payment.js";
import { Room } from "../models/Room.js";
import { ApiResponse } from "../utils/response.js";
import {
  buildContractInstallments,
  calculateContractPayment,
} from "../utils/contractPayment.js";
import { periodKeyInTashkent, tashkentDayStart } from "../utils/paymentTime.js";
import { reserveRoomBed } from "../services/roomBeds.js";
import { recordId } from "../utils/roomBeds.js";
import { cancelledReportPeriod } from "../utils/cancelledReportPeriod.js";

class StudentContractController {
  cleanPayload(body) {
    const payload = {
      student: body.student,
      room: body.room,
      bedNumber: body.bedNumber == null || body.bedNumber === "" ? null : Number(body.bedNumber),
      contractNumber: String(body.contractNumber || "").trim(),
      startDate: body.startDate,
      endDate: body.endDate,
      paymentType: body.paymentType || "monthly",
      paymentAmount: Number(body.paymentAmount),
      depositEnabled: (body.paymentType || "monthly") === "daily" && body.depositEnabled === true,
      depositAmount: (body.paymentType || "monthly") === "daily" && body.depositEnabled === true
        ? Number(body.depositAmount)
        : 0,
      status: body.status || "active",
      note: String(body.note || "").trim(),
    };
    return {
      ...payload,
      ...calculateContractPayment(
        payload.startDate,
        payload.endDate,
        payload.paymentType,
        payload.paymentAmount,
      ),
    };
  }

  emitChange(req, action, contract) {
    req.app
      .get("io")
      ?.emit("student-contracts:changed", {
        action,
        studentId: recordId(contract?.student),
        contractId: contract?.id || contract?._id?.toString(),
      });
    req.app
      .get("io")
      ?.emit("rooms:changed", {
        action: "occupancy-changed",
        roomId: recordId(contract?.room),
        occurredAt: new Date().toISOString(),
      });
  }

  async syncInstallments(contract) {
    const paidInstallmentExists = await ContractInstallment.exists({
      contract: contract._id,
      paidAmount: { $gt: 0 },
    });
    if (paidInstallmentExists)
      throw Object.assign(
        new Error(
          "To‘lov qilingan shartnomaning sana yoki tarifini o‘zgartirib bo‘lmaydi",
        ),
        { status: 409 },
      );
    const desiredInstallments = buildContractInstallments(contract);
    const existingInstallments = await ContractInstallment.find({ contract: contract._id }).setOptions({ withDeleted: true });
    const existingByIndex = new Map(existingInstallments.map((item) => [item.periodIndex, item]));
    await Promise.all(desiredInstallments.map(async (desired) => {
      const existing = existingByIndex.get(desired.periodIndex);
      if (!existing) return ContractInstallment.create(desired);
      existing.set({ ...desired, isDeleted: false, deletedAt: null, deletedBy: null });
      existingByIndex.delete(desired.periodIndex);
      return existing.save();
    }));
    await Promise.all([...existingByIndex.values()].map((installment) => {
      installment.set({ isDeleted: true, deletedAt: new Date() });
      return installment.save();
    }));
  }

  async updateInstallments(contract, session) {
    const desiredInstallments = buildContractInstallments(contract);
    const existingInstallments = await ContractInstallment.find({
      contract: contract._id,
    }).setOptions({ withDeleted: true }).session(session);
    const existingByIndex = new Map(
      existingInstallments.map((item) => [item.periodIndex, item]),
    );
    const operations = desiredInstallments.map((desired) => {
      const existing = existingByIndex.get(desired.periodIndex);
      if (!existing) return { insertOne: { document: desired } };
      const paidAmount = existing.paidAmount || 0;
      return {
        updateOne: {
          filter: { _id: existing._id },
          update: {
            $set: {
              student: desired.student,
              periodKey: desired.periodKey,
              dueDate: desired.dueDate,
              amount: desired.amount,
              isDeleted: false,
              deletedAt: null,
              deletedBy: null,
              status:
                paidAmount <= 0
                  ? "unpaid"
                  : paidAmount >= desired.amount
                    ? "paid"
                    : "partial",
            },
          },
        },
      };
    });
    const desiredIndexes = new Set(desiredInstallments.map((item) => item.periodIndex));
    existingInstallments
      .filter((item) => !desiredIndexes.has(item.periodIndex))
      .forEach((item) => {
        // Keep the original installment available to its payment records.
        const changes = item.paidAmount > 0
          ? { amount: 0, status: "paid", isDeleted: false, deletedAt: null, deletedBy: null }
          : { isDeleted: true, deletedAt: new Date() };
        operations.push({
          updateOne: {
            filter: { _id: item._id },
            update: { $set: changes },
          },
        });
      });
    if (operations.length) await ContractInstallment.bulkWrite(operations, { session });
  }

  async validateInstallmentAmounts(contract, session) {
    const desiredByIndex = new Map(
      buildContractInstallments(contract).map((item) => [item.periodIndex, item]),
    );
    const existingInstallments = await ContractInstallment.find({
      contract: contract._id,
    }).select("periodIndex amount paidAmount").session(session);
    const removedPaidInstallment = existingInstallments.find(
      (existing) => !desiredByIndex.has(existing.periodIndex) && existing.amount > 0 && (existing.paidAmount || 0) > 0,
    );
    if (removedPaidInstallment)
      return "To‘lov qilingan davrni shartnoma muddatidan chiqarib bo‘lmaydi";
    const invalidInstallment = existingInstallments.find((existing) => {
      const desired = desiredByIndex.get(existing.periodIndex);
      return desired && (existing.paidAmount || 0) > desired.amount;
    });
    return invalidInstallment
      ? "Yangi shartnoma summasi to‘langan summadan kam bo‘lmasligi kerak"
      : null;
  }

  async ensureInstallments(contract) {
    if (
      contract.totalAmount == null ||
      contract.billingQuantity == null ||
      contract.durationDays == null
    ) {
      Object.assign(
        contract,
        calculateContractPayment(
          contract.startDate,
          contract.endDate,
          contract.paymentType,
          contract.paymentAmount,
        ),
      );
      await contract.save();
    }
    if (!(await ContractInstallment.exists({ contract: contract._id }))) {
      await ContractInstallment.insertMany(buildContractInstallments(contract));
    }
  }

  listByStudent = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.studentId))
        return ApiResponse.notFound(res, "Talaba topilmadi");
      const contracts = await StudentContract.find({
        student: req.params.studentId,
      })
        .populate("room", "roomNumber block floor")
        .sort({ startDate: -1, createdAt: -1 });
      await Promise.all(
        contracts.map((contract) => this.ensureInstallments(contract)),
      );
      return ApiResponse.ok(res, { contracts });
    } catch (error) {
      return next(error);
    }
  };

  listActive = async (req, res, next) => {
    try {
      const cancellationPeriod = cancelledReportPeriod(req.query.cancelledPeriod, req.query.cancelledView, periodKeyInTashkent(new Date()));
      if (!cancellationPeriod) return ApiResponse.badRequest(res, 'Bekor qilingan shartnomalar hisobining oyini yoki yilini to‘g‘ri tanlang');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const filter = { status: "active", startDate: { $lt: tomorrow }, endDate: { $gte: today } };
      if (mongoose.isValidObjectId(req.query.room)) filter.room = req.query.room;
      if (["student_contract", "standard_contract"].includes(req.query.contractType)) {
        filter.student = { $in: await Student.distinct("_id", { hasTaxContract: true, taxContractType: req.query.contractType }) };
      }
      const currentPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
      const summaryFilter = {
        ...(filter.student ? { student: filter.student } : {}),
        ...(filter.room ? { room: filter.room } : {}),
      };
      const validStudentIds = await Student.distinct("_id");
      const validStudentIdSet = new Set(validStudentIds.map(String));
      const scopedStudentIds = summaryFilter.student
        ? summaryFilter.student.$in.filter((id) => validStudentIdSet.has(String(id)))
        : validStudentIds;
      summaryFilter.student = { $in: scopedStudentIds };
      filter.student = { $in: scopedStudentIds };

      const search = String(req.query.search || "").trim();
      if (search) {
        const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(escapedSearch, "i");
        const [matchingStudentIds, matchingRoomIds] = await Promise.all([
          Student.distinct("_id", { _id: { $in: scopedStudentIds }, $or: [{ fullName: pattern }, { phone: pattern }] }),
          Room.distinct("_id", { $or: [{ block: pattern }, { roomNumber: pattern }] }),
        ]);
        filter.$or = [
          { contractNumber: pattern },
          { student: { $in: matchingStudentIds } },
          { room: { $in: matchingRoomIds } },
        ];
      }

      const limit = req.query.export === "1" ? 5000 : 25;
      const requestedPage = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const warningLimit = new Date(today);
      warningLimit.setDate(warningLimit.getDate() + 3);
      let [summaryContracts, total, pageRows] = await Promise.all([
        StudentContract.find(summaryFilter).select("_id status cancelledAt").lean(),
        StudentContract.countDocuments(filter),
        StudentContract.aggregate([
          { $match: filter },
          { $addFields: {
            warningRank: { $cond: [{ $lt: ["$endDate", warningLimit] }, 0, 1] },
            warningEndDate: { $cond: [{ $lt: ["$endDate", warningLimit] }, "$endDate", null] },
          } },
          { $sort: { warningRank: 1, warningEndDate: 1, createdAt: -1 } },
          { $skip: (requestedPage - 1) * limit },
          { $limit: limit },
          { $project: { _id: 1 } },
        ]),
      ]);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const page = Math.min(requestedPage, totalPages);
      if (page !== requestedPage) {
        pageRows = await StudentContract.aggregate([
          { $match: filter },
          { $addFields: {
            warningRank: { $cond: [{ $lt: ["$endDate", warningLimit] }, 0, 1] },
            warningEndDate: { $cond: [{ $lt: ["$endDate", warningLimit] }, "$endDate", null] },
          } },
          { $sort: { warningRank: 1, warningEndDate: 1, createdAt: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          { $project: { _id: 1 } },
        ]);
      }
      const summaryContractIds = summaryContracts.map((contract) => contract._id);
      const cancelledIds = summaryContracts.filter((contract) => contract.status === 'cancelled').map((contract) => contract._id);
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      const selectedCancelledIds = summaryContracts
        .filter((contract) => contract.status === 'cancelled' && contract.cancelledAt >= cancellationPeriod.start && contract.cancelledAt < cancellationPeriod.end)
        .map((contract) => contract._id);
      const pageIds = pageRows.map((row) => row._id);
      const [currentMonthRows, cancelledPaidRows, cancelledPaidByPeriodRows, pageContracts] = await Promise.all([
        ContractInstallment.aggregate([
          { $match: { periodKey: currentPeriod, contract: { $in: summaryContractIds }, student: { $in: validStudentIds } } },
          { $group: { _id: "$contract", amount: { $sum: "$amount" } } },
        ]),
        cancelledIds.length ? Payment.aggregate([
          { $match: { contract: { $in: cancelledIds }, student: { $in: validStudentIds }, paymentPurpose: { $ne: 'deposit' }, status: 'active', cancelledAt: null, createdAt: { $gte: monthStart, $lt: monthEnd } } },
          { $group: { _id: null, amount: { $sum: '$amount' } } },
        ]) : [],
        selectedCancelledIds.length ? Payment.aggregate([
          { $match: { contract: { $in: selectedCancelledIds }, student: { $in: validStudentIds }, paymentPurpose: { $ne: 'deposit' }, status: 'active', cancelledAt: null } },
          { $lookup: { from: StudentContract.collection.name, localField: 'contract', foreignField: '_id', as: 'cancelledContract' } },
          { $unwind: '$cancelledContract' },
          { $unwind: '$allocations' },
          { $lookup: { from: ContractInstallment.collection.name, localField: 'allocations.installment', foreignField: '_id', as: 'installment' } },
          { $unwind: '$installment' },
          { $match: { $expr: { $and: [
            { $eq: ['$installment.contract', '$contract'] },
            { $gt: ['$installment.periodKey', { $dateToString: { format: '%Y-%m', date: '$cancelledContract.cancelledAt', timezone: 'Asia/Tashkent' } }] },
          ] } } },
          { $group: { _id: '$installment.periodKey', amount: { $sum: '$allocations.amount' } } },
          { $sort: { _id: 1 } },
        ]) : [],
        pageIds.length ? StudentContract.find({ _id: { $in: pageIds } })
          .populate({ path: "student", select: "fullName phone parentPhone passportSeries passportNumber jshr photo university faculty course gender educationType hasTaxContract taxContractType", populate: [{ path: "university", select: "name shortName" }, { path: "faculty", select: "name" }] })
          .populate("room", "roomNumber block floor") : [],
      ]);
      const summary = summaryContracts.reduce((result, contract) => {
        result.total += 1;
        if (Object.prototype.hasOwnProperty.call(result, contract.status)) result[contract.status] += 1;
        return result;
      }, { total: 0, active: 0, completed: 0, cancelled: 0, amount: 0, amountByStatus: { active: 0, completed: 0, cancelled: 0 } });
      const statusByContract = new Map(summaryContracts.map((contract) => [String(contract._id), contract.status]));
      for (const row of currentMonthRows) {
        const status = statusByContract.get(String(row._id));
        if (status !== 'cancelled') summary.amount += row.amount;
        if (Object.prototype.hasOwnProperty.call(summary.amountByStatus, status)) {
          summary.amountByStatus[status] += row.amount;
        }
      }
      summary.cancelledPaidAmount = cancelledPaidRows[0]?.amount || 0;
      summary.cancelledFuturePaidByPeriod = cancelledPaidByPeriodRows.map((row) => ({ period: row._id, amount: row.amount }));
      summary.cancelledFuturePaidAmount = summary.cancelledFuturePaidByPeriod.reduce((totalAmount, row) => totalAmount + row.amount, 0);
      summary.cancelledReportPeriod = cancellationPeriod.period;
      summary.cancelledReportView = cancellationPeriod.mode;
      const contractsById = new Map(pageContracts.filter((contract) => contract.student && contract.room).map((contract) => [contract.id, contract]));
      const rows = pageIds.map((id) => contractsById.get(String(id))).filter(Boolean);
      return ApiResponse.ok(res, { contracts: rows, summary, pagination: { page, limit, total, totalPages } });
    } catch (error) {
      return next(error);
    }
  };

  create = async (req, res, next) => {
    try {
      const payload = this.cleanPayload(req.body);
      payload.status = "active";
      if (!Number.isFinite(payload.paymentAmount) || payload.paymentAmount <= 0)
        return ApiResponse.badRequest(res, "To‘lov summasi 0 dan katta bo‘lishi kerak");
      if (payload.depositEnabled && (!Number.isFinite(payload.depositAmount) || payload.depositAmount <= 0))
        return ApiResponse.badRequest(res, "Deposit summasi 0 dan katta bo‘lishi kerak");
      if (!mongoose.isValidObjectId(payload.student))
        return ApiResponse.badRequest(res, "Talabani to‘g‘ri tanlang");
      if (!payload.durationDays)
        return ApiResponse.badRequest(res, "Tugash sanasi boshlanish sanasidan keyin bo‘lishi kerak");
      const contract = new StudentContract(payload);
      await contract.validate();
      await mongoose.connection.transaction(async (session) => {
        await reserveRoomBed(payload, session);
        await contract.save({ session });
        await ContractInstallment.insertMany(buildContractInstallments(contract), { session });
        await contract.populate({ path: "room", select: "roomNumber block floor", options: { session } });
      });
      this.emitChange(req, "created", contract);
      return ApiResponse.created(res, { contract }, "Shartnoma tuzildi");
    } catch (error) {
      return next(error);
    }
  };

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id))
        return ApiResponse.notFound(res, "Shartnoma topilmadi");
      const payload = this.cleanPayload(req.body);
      if (!Number.isFinite(payload.paymentAmount) || payload.paymentAmount <= 0)
        return ApiResponse.badRequest(res, "To‘lov summasi 0 dan katta bo‘lishi kerak");
      if (payload.depositEnabled && (!Number.isFinite(payload.depositAmount) || payload.depositAmount <= 0))
        return ApiResponse.badRequest(res, "Deposit summasi 0 dan katta bo‘lishi kerak");
      if (!payload.durationDays)
        return ApiResponse.badRequest(
          res,
          "Tugash sanasi boshlanish sanasidan keyin bo‘lishi kerak",
        );
      if (payload.status !== "cancelled")
        payload.status = new Date(payload.endDate) < tashkentDayStart(new Date()) ? "completed" : "active";
      if (!mongoose.isValidObjectId(payload.student))
        return ApiResponse.badRequest(res, "Talabani to‘g‘ri tanlang");
      const current = await StudentContract.findById(req.params.id);
      if (!current) return ApiResponse.notFound(res, "Shartnoma topilmadi");
      const { contract, conflict } = await mongoose.connection.transaction(async (session) => {
        const existing = await StudentContract.findById(req.params.id).session(session);
        if (!existing) return {};
        const datesChanged =
          existing.startDate.getTime() !== new Date(payload.startDate).getTime() ||
          existing.endDate.getTime() !== new Date(payload.endDate).getTime();
        const isCancelled = existing.status === "cancelled";
        const changes = isCancelled ? {
          startDate: payload.startDate,
          endDate: payload.endDate,
          ...calculateContractPayment(payload.startDate, payload.endDate, existing.paymentType, existing.paymentAmount),
        } : {
          ...payload,
          cancelledAt: payload.status === "cancelled" ? new Date() : existing.cancelledAt,
        };
        if (!isCancelled) {
          if (changes.bedNumber == null && String(existing.room) === String(changes.room)) changes.bedNumber = existing.bedNumber;
          await reserveRoomBed(changes, session, { excludeContractId: existing._id, previousRoom: existing.room });
        }
        const paymentTypeChanged = !isCancelled && existing.paymentType !== payload.paymentType;
        const rateChanged = !isCancelled && existing.paymentAmount !== payload.paymentAmount;
        if (paymentTypeChanged || rateChanged) {
          if (paymentTypeChanged && await ContractInstallment.exists({
            contract: existing._id,
            paidAmount: { $gt: 0 },
          }).session(session)) {
            return { conflict: "To‘lov qilingan shartnomaning turini o‘zgartirib bo‘lmaydi" };
          }
          const installmentError = await this.validateInstallmentAmounts({
            ...changes,
            _id: existing._id,
          }, session);
          if (installmentError) return { conflict: installmentError };
        }

        const updated = await StudentContract.findByIdAndUpdate(
          existing._id,
          changes,
          { new: true, runValidators: true, session },
        ).populate("room", "roomNumber block floor");
        if (datesChanged || paymentTypeChanged || rateChanged) await this.updateInstallments(updated, session);
        return { contract: updated };
      });
      if (conflict) return ApiResponse.conflict(res, conflict);
      if (!contract) return ApiResponse.notFound(res, "Shartnoma topilmadi");
      this.emitChange(req, "updated", contract);
      return ApiResponse.ok(res, { contract }, "Shartnoma yangilandi");
    } catch (error) {
      return next(error);
    }
  };

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id))
        return ApiResponse.notFound(res, "Shartnoma topilmadi");
      const contract = await StudentContract.findById(req.params.id);
      if (!contract) return ApiResponse.notFound(res, "Shartnoma topilmadi");
      return ApiResponse.conflict(
        res,
        contract.status === "active"
          ? "Amaldagi shartnomani o‘chirib bo‘lmaydi. Muddatidan oldin faqat bekor qilish mumkin"
          : "Shartnoma tarixini saqlash uchun yakunlangan yoki bekor qilingan shartnoma o‘chirilmaydi",
      );
    } catch (error) {
      return next(error);
    }
  };
}

export const studentContractController = new StudentContractController();
