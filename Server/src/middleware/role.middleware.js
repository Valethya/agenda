export const isAdmin = (req, res, next) => {
  if (!req.session || !req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({
      status: "fail",
      message: "Acceso denegado. Se requieren permisos de Administrador.",
    });
  }
  next();
};

export const isSuperadmin = (req, res, next) => {
  if (!req.session || !req.session.user || req.session.user.role !== "superadmin") {
    return res.status(403).json({
      status: "fail",
      message: "Acceso denegado. Se requieren permisos de Superadmin.",
    });
  }
  next();
};
