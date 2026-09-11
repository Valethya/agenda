import { Router } from "express";
import mongoose from "mongoose";
import { getHealth } from "../controllers/health.controller.js";

const router = Router();

export const readinessState = async ({ connection = mongoose.connection } = {}) => {
  if (connection.readyState !== 1 || !connection.db) return { ready: false };
  try {
    await connection.db.admin().ping();
    return { ready: true };
  } catch {
    return { ready: false };
  }
};

// Preserve the historical /api/health contract while adding explicit probes.
router.get("/", getHealth);

router.get("/live", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

router.get("/ready", async (_req, res) => {
  const state = await readinessState();
  if (!state.ready) return res.status(503).json({ status: "degraded" });
  return res.status(200).json({ status: "ready" });
});

export default router;
