import * as userRepository from "../repositories/user.repository.js";

export const isAuthenticated = async (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ message: "No autorizado" });
  }

  try {
    const user = req.tenantAuthority?.user || await userRepository.findById(req.session.user.id);
    if (!user || user.isActive !== true) {
      return res.status(401).json({ message: "No autorizado" });
    }

    req.authenticatedUser = user;
    next();
  } catch (error) {
    next(error);
  }
};
