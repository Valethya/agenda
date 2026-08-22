import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDB } from "../src/db/db.js";
import Payment from "../src/db/models/payment.model.js";
import { getGlobalMetrics } from "../src/services/analytics.service.js";

await connectDB();

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const businessA = new mongoose.Types.ObjectId();
const businessB = new mongoose.Types.ObjectId();
const transactionIds = [
  `metrics-mismatch-${suffix}`,
  `metrics-legacy-${suffix}`,
  `metrics-other-tenant-${suffix}`,
];

await Payment.create([
  {
    appointment: new mongoose.Types.ObjectId(),
    business: businessA,
    amount: 5000,
    authorizedAmount: 7000,
    currency: "CLP",
    gateway: "webpay",
    transactionId: transactionIds[0],
    status: "approved",
    type: "deposit",
    reconciliationStatus: "required",
    reconciliationReason: "amount_mismatch",
    authorizedAt: new Date(),
  },
  {
    appointment: new mongoose.Types.ObjectId(),
    business: businessA,
    amount: 4000,
    currency: "CLP",
    gateway: "webpay",
    transactionId: transactionIds[1],
    status: "approved",
    type: "deposit",
  },
  {
    appointment: new mongoose.Types.ObjectId(),
    business: businessB,
    amount: 9000,
    authorizedAmount: 12000,
    currency: "CLP",
    gateway: "webpay",
    transactionId: transactionIds[2],
    status: "approved",
    type: "deposit",
    reconciliationStatus: "required",
    reconciliationReason: "amount_mismatch",
    authorizedAt: new Date(),
  },
]);

test("6.2.6-A financial metrics use authorizedAmount when present and preserve legacy amount fallback", async () => {
  const metrics = await getGlobalMetrics(businessA.toString());

  assert.equal(metrics.finances.totalRevenue, 11000);
  assert.equal(metrics.finances.totalTransactions, 2);
  assert.equal(metrics.finances.averageTicket, 5500);

  const mismatchPayment = await Payment.findOne({ transactionId: transactionIds[0] }).lean();
  assert.equal(mismatchPayment.amount, 5000);
  assert.equal(mismatchPayment.authorizedAmount, 7000);
  assert.equal(mismatchPayment.reconciliationStatus, "required");
  assert.equal(mismatchPayment.reconciliationReason, "amount_mismatch");

  const legacyPayment = await Payment.findOne({ transactionId: transactionIds[1] }).lean();
  assert.equal(legacyPayment.amount, 4000);
  assert.equal(legacyPayment.authorizedAmount, undefined);

  const otherTenantPayment = await Payment.findOne({ transactionId: transactionIds[2] }).lean();
  assert.equal(otherTenantPayment.business.toString(), businessB.toString());
});

test.after(async () => {
  await Payment.deleteMany({ transactionId: { $in: transactionIds } });
  await mongoose.disconnect();
});
