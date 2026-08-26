import { Router } from "express";
import { getTeam, patchMembership } from "../controllers/adminTeam.controller.js";
import { scopeBusiness } from "../middleware/business.middleware.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { isAdmin } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { updateTeamMembershipSchema } from "../validations/adminTeam.validation.js";

const router = Router();

// Team es una superficie tenant-interna. scopeBusiness revalida Membership
// vigente desde persistencia y además exige el Business seleccionado en sesión.
router.get("/", scopeBusiness, isAuthenticated, isAdmin, getTeam);

router.patch(
  "/memberships/:membershipId",
  scopeBusiness,
  isAuthenticated,
  isAdmin,
  validate(updateTeamMembershipSchema, { assignBody: "teamMembershipPatch" }),
  patchMembership,
);

export default router;
