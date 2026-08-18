import { Router } from "express";
import {
  createWorker,
  deleteWorker,
  getWorkers,
} from "../controllers/user.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { isAdmin } from "../middleware/role.middleware.js";
import { scopeBusiness, scopeHeadlessOrSessionBusiness } from "../middleware/business.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createWorkerSchema, objectIdParamSchema } from "../validations/common.validation.js";

const router = Router();

router.get("/workers", scopeHeadlessOrSessionBusiness, getWorkers);

router.post("/workers", scopeBusiness, isAuthenticated, isAdmin, validate(createWorkerSchema), createWorker);
router.delete("/workers/:id", scopeBusiness, isAuthenticated, isAdmin, validate(objectIdParamSchema), deleteWorker);

export default router;
