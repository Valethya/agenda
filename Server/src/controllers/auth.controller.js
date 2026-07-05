import * as authService from "../services/auth.service.js";
import User from "../db/models/user.model.js";
import Membership from "../db/models/membership.model.js";

export const register = async (req, res, next) => {
  try {
    const user = await authService.register(req.body);
    res.status(201).json({
      status: "succes",
      message: "usuario creado correctamente",
      payload: user,
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await authService.login(email, password);

    // Si es superadmin
    if (user.role === "superadmin") {
      req.session.user = {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: "superadmin",
      };
      return req.session.save((err) => {
        if (err) return next(err);
        res.status(201).json({
          status: "success",
          message: "Login exitoso como superadmin",
          user: req.session.user,
          payload: req.session.user,
        });
      });
    }

    if (!user.memberships || user.memberships.length === 0) {
      throw new UnauthorizedError("Tu cuenta no tiene ningún negocio asociado");
    }

    // Si tiene exactamente 1 negocio
    if (user.memberships.length === 1) {
      const active = user.memberships[0];
      req.session.user = {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: active.role,
        businessId: active.businessId,
        businessSlug: active.businessSlug,
      };
      return req.session.save((err) => {
        if (err) return next(err);
        res.status(201).json({
          status: "success",
          message: "Login exitoso",
          user: req.session.user,
          payload: req.session.user,
        });
      });
    }

    // Si tiene múltiples negocios, guardamos en sesión temporal para selección posterior
    req.session.tempUser = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      memberships: user.memberships,
    };

    req.session.save((err) => {
      if (err) return next(err);
      res.status(200).json({
        status: "needs_selection",
        message: "Se requiere seleccionar un negocio",
        memberships: user.memberships,
      });
    });
  } catch (error) {
    next(error);
  }
};

export const logout = (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      return next(error);
    }

    res.clearCookie("connect.sid");

    return res.status(200).json({
      status: "success",
      message: "Logout exitoso",
    });
  });
};

export const googleLogin = async (req, res, next) => {
  try {
    const { idToken } = req.body;
    const user = await authService.loginWithGoogle(idToken);

    // Si es superadmin
    if (user.role === "superadmin") {
      req.session.user = {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: "superadmin",
      };
      return req.session.save((err) => {
        if (err) return next(err);
        res.status(200).json({
          status: "success",
          message: "Login con Google exitoso como superadmin",
          user: req.session.user,
          payload: req.session.user,
        });
      });
    }

    if (!user.memberships || user.memberships.length === 0) {
      throw new UnauthorizedError("Tu cuenta no tiene ningún negocio asociado");
    }

    // Si tiene exactamente 1 negocio
    if (user.memberships.length === 1) {
      const active = user.memberships[0];
      req.session.user = {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: active.role,
        businessId: active.businessId,
        businessSlug: active.businessSlug,
      };
      return req.session.save((err) => {
        if (err) return next(err);
        res.status(200).json({
          status: "success",
          message: "Login con Google exitoso",
          user: req.session.user,
          payload: req.session.user,
        });
      });
    }

    // Si tiene múltiples negocios
    req.session.tempUser = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      memberships: user.memberships,
    };

    req.session.save((err) => {
      if (err) return next(err);
      res.status(200).json({
        status: "needs_selection",
        message: "Se requiere seleccionar un negocio",
        memberships: user.memberships,
      });
    });
  } catch (error) {
    next(error);
  }
};

export const selectMembership = async (req, res, next) => {
  try {
    const { membershipId } = req.body;
    if (!req.session.tempUser) {
      throw new UnauthorizedError("No hay una sesión temporal activa. Inicia sesión nuevamente.");
    }

    const selected = req.session.tempUser.memberships.find(m => m.id.toString() === membershipId);
    if (!selected) {
      throw new ValidationError("La membresía seleccionada es inválida para este usuario");
    }

    req.session.user = {
      id: req.session.tempUser.id,
      firstName: req.session.tempUser.firstName,
      lastName: req.session.tempUser.lastName,
      email: req.session.tempUser.email,
      role: selected.role,
      businessId: selected.businessId,
      businessSlug: selected.businessSlug,
    };

    delete req.session.tempUser; // Limpiar sesión temporal

    req.session.save((err) => {
      if (err) return next(err);
      res.status(200).json({
        status: "success",
        message: "Negocio seleccionado con éxito",
        user: req.session.user,
        payload: req.session.user,
      });
    });
  } catch (error) {
    next(error);
  }
};

export const switchBusiness = async (req, res, next) => {
  try {
    const { businessId } = req.body;
    if (!req.session.user) {
      throw new UnauthorizedError("Inicia sesión para cambiar de negocio");
    }

    // Si es superadmin, tiene acceso a cualquier negocio
    if (req.session.user.role === "superadmin") {
      const BusinessModel = (await import("../db/models/business.model.js")).default;
      const targetBusiness = await BusinessModel.findById(businessId);
      if (!targetBusiness) {
        throw new ValidationError("El negocio especificado no existe");
      }
      req.session.user.businessId = targetBusiness._id;
      req.session.user.businessSlug = targetBusiness.slug;
      
      return req.session.save((err) => {
        if (err) return next(err);
        res.status(200).json({
          status: "success",
          message: "Cambiado de negocio como superadmin",
          user: req.session.user,
          payload: req.session.user,
        });
      });
    }

    const membership = await Membership.findOne({
      user: req.session.user.id,
      business: businessId,
      isActive: true,
    }).populate("business");

    if (!membership) {
      throw new UnauthorizedError("No tienes acceso a este negocio");
    }

    req.session.user.businessId = membership.business._id;
    req.session.user.businessSlug = membership.business.slug;
    req.session.user.role = membership.role;

    req.session.save((err) => {
      if (err) return next(err);
      res.status(200).json({
        status: "success",
        message: "Cambiado de negocio exitosamente",
        user: req.session.user,
        payload: req.session.user,
      });
    });
  } catch (error) {
    next(error);
  }
};

export const getCurrentUser = async (req, res, next) => {
  try {
    if (!req.session || !req.session.user) {
      return res.status(401).json({
        status: "fail",
        message: "No hay sesión activa",
      });
    }

    // Verificar que el usuario exista en la base de datos para prevenir sesiones huérfanas
    const userExists = await User.findById(req.session.user.id);
    if (!userExists) {
      req.session.destroy();
      res.clearCookie("connect.sid");
      return res.status(401).json({
        status: "fail",
        message: "El usuario ya no existe o su cuenta fue eliminada",
      });
    }

    // Buscar membresías para inyectarlas al frontend (para el switch de negocio)
    let membershipsPayload = [];
    if (req.session.user.role !== "superadmin") {
      const memberships = await Membership.find({ user: req.session.user.id, isActive: true }).populate("business");
      membershipsPayload = memberships.map((m) => ({
        id: m._id,
        businessId: m.business?._id,
        businessName: m.business?.name,
        businessSlug: m.business?.slug,
        role: m.role,
      }));
    }

    const userPayload = {
      ...req.session.user,
      memberships: membershipsPayload
    };

    res.status(200).json({
      status: "success",
      user: userPayload,
      payload: userPayload,
    });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    await authService.sendResetPasswordEmail(email);

    // Mensaje genérico de éxito para prevenir la enumeración de usuarios
    res.status(200).json({
      status: "success",
      message: "Si el correo está registrado en nuestro sistema, recibirás un correo de recuperación en breve.",
    });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    await authService.resetPassword(token, newPassword);

    res.status(200).json({
      status: "success",
      message: "Contraseña restablecida correctamente",
    });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.session.user.id;

    await authService.updatePassword(userId, currentPassword, newPassword);

    res.status(200).json({
      status: "success",
      message: "Contraseña cambiada exitosamente",
    });
  } catch (error) {
    next(error);
  }
};
