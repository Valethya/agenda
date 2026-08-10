import * as superadminService from "../services/superadmin.service.js";
import { UnauthorizedError } from "../utils/appError.js";

export const getPlatformMetrics = async (req, res, next) => {
  try {
    const metrics = await superadminService.getGlobalMetrics(req.query.businessId);
    res.status(200).json({ status: "success", payload: metrics });
  } catch (error) { next(error); }
};

export const getAdvancedPlatformAnalytics = async (req, res, next) => {
  try {
    const advancedAnalytics = await superadminService.getAdvancedAnalytics(req.query.businessId);
    res.status(200).json({ status: "success", payload: advancedAnalytics });
  } catch (error) { next(error); }
};

export const listBusinesses = async (req, res, next) => {
  try {
    res.status(200).json({ status: "success", payload: await superadminService.listBusinesses() });
  } catch (error) { next(error); }
};

export const createBusiness = async (req, res, next) => {
  try {
    res.status(201).json({ status: "success", payload: await superadminService.createBusiness(req.body) });
  } catch (error) { next(error); }
};

export const toggleBusinessStatus = async (req, res, next) => {
  try {
    res.status(200).json({ status: "success", payload: await superadminService.toggleBusinessStatus(req.params.id) });
  } catch (error) { next(error); }
};

export const impersonateBusiness = async (req, res, next) => {
  try {
    const { user, business, membership } = await superadminService.impersonate(req.params.id);
    req.session.originalUser = { ...req.session.user };

    req.session.user = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: Array.isArray(user.email) ? user.email[0] : user.email,
      // Contexto de presentación únicamente; cada request revalida esta Membership.
      role: membership.role,
      businessId: business._id,
      businessSlug: business.slug,
      isImpersonating: true,
    };

    req.session.save((err) => {
      if (err) return next(err);
      res.status(200).json({
        status: "success",
        message: `Impersonación iniciada para ${business.name}`,
        user: req.session.user,
        payload: req.session.user,
      });
    });
  } catch (error) { next(error); }
};

export const stopImpersonatingBusiness = async (req, res, next) => {
  try {
    if (!req.session.originalUser) throw new UnauthorizedError("No estás impersonando ningún negocio");
    req.session.user = { ...req.session.originalUser };
    delete req.session.originalUser;

    req.session.save((err) => {
      if (err) return next(err);
      res.status(200).json({
        status: "success",
        message: "Impersonación detenida con éxito",
        user: req.session.user,
        payload: req.session.user,
      });
    });
  } catch (error) { next(error); }
};
