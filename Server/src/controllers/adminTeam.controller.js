import * as adminTeamService from "../services/adminTeam.service.js";

export const getTeam = async (req, res, next) => {
  try {
    const team = await adminTeamService.listTeam({
      businessId: req.businessId,
      ownerId: req.business.owner,
    });

    res.status(200).json({
      status: "success",
      payload: { team },
    });
  } catch (error) {
    next(error);
  }
};

export const patchMembership = async (req, res, next) => {
  try {
    const membership = await adminTeamService.updateExistingMembership({
      businessId: req.businessId,
      actorUserId: req.tenantAuthority.userId,
      membershipId: req.params.membershipId,
      patch: req.teamMembershipPatch,
    });

    res.status(200).json({
      status: "success",
      payload: { membership },
    });
  } catch (error) {
    next(error);
  }
};
