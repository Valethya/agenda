import * as userService from "../services/user.service.js";
import { getPublicProfessionalsForService } from "../services/publicBookingContract.service.js";

export const createWorker = async (_req, _res, next) => {
  try {
    await userService.createWorker();
  } catch (error) { next(error); }
};

export const deleteWorker = async (_req, _res, next) => {
  try {
    await userService.deleteWorker();
  } catch (error) { next(error); }
};

export const getWorkers = async (req, res, next) => {
  try {
    if (req.bookingSurface === "public") {
      const workers = await getPublicProfessionalsForService({
        businessId: req.businessId,
        serviceId: req.query.serviceId,
      });
      return res.status(200).json({ status: "success", results: workers.length, payload: workers });
    }

    const workers = await userService.getWorkersList(req.businessId);
    return res.status(200).json({ status: "success", results: workers.length, payload: workers });
  } catch (error) { next(error); }
};
