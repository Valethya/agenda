import { hasTenantRole } from "../services/tenantAuthority.service.js";

export const isAdmin = (req, res, next) => {
  if (!hasTenantRole(req.tenantAuthority, "admin")) {
    return res.status(403).json({
      status: "fail",
      message: "Acceso denegado. Se requieren permisos de Administrador.",
    });
  }
  next();
};

export const isWorkerOrAdmin = (req, res, next) => {
  if (!hasTenantRole(req.tenantAuthority, "admin", "worker")) {
    return res.status(403).json({
      status: "fail",
      message: "Acceso denegado. Se requiere una membresía activa del negocio.",
    });
  }
  next();
};

export const isSuperadmin = (req, res, next) => {
  if (!req.authenticatedUser || req.authenticatedUser.role !== "superadmin") {
    return res.status(403).json({
      status: "fail",
      message: "Acceso denegado. Se requieren permisos de Superadmin.",
    });
  }
  next();
};
