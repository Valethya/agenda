import * as authService from "../services/auth.service.js";
import { UnauthorizedError, ValidationError } from "../utils/appError.js";

/**
 * Helper: guarda la sesión y responde con JSON.
 * Elimina la duplicación del patrón req.session.save + res.json.
 */
const saveSessionAndRespond = (req, res, next, statusCode, body) => {
  req.session.save((err) => {
    if (err) return next(err);
    res.status(statusCode).json(body);
  });
};

/**
 * Helper: configura la sesión según el resultado de resolveSessionFromUser
 * y envía la respuesta HTTP correspondiente.
 */
const handleLoginResult = (req, res, next, user, successMessage) => {
  const result = authService.resolveSessionFromUser(user);

  if (result.type === "superadmin" || result.type === "single") {
    req.session.user = result.sessionUser;
    return saveSessionAndRespond(req, res, next, result.type === "superadmin" ? 200 : 201, {
      status: "success",
      message: successMessage,
      user: result.sessionUser,
      payload: result.sessionUser,
    });
  }

  // needs_selection
  req.session.tempUser = result.tempUser;
  saveSessionAndRespond(req, res, next, 200, {
    status: "needs_selection",
    message: "Se requiere seleccionar un negocio",
    memberships: result.memberships,
  });
};

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
    handleLoginResult(req, res, next, user, "Login exitoso");
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
    handleLoginResult(req, res, next, user, "Login con Google exitoso");
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

    saveSessionAndRespond(req, res, next, 200, {
      status: "success",
      message: "Negocio seleccionado con éxito",
      user: req.session.user,
      payload: req.session.user,
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

    const updates = await authService.switchBusiness(
      req.session.user.id,
      req.session.user.role,
      businessId,
    );

    // Aplicar los campos actualizados a la sesión
    req.session.user.businessId = updates.businessId;
    req.session.user.businessSlug = updates.businessSlug;
    if (updates.role) {
      req.session.user.role = updates.role;
    }

    saveSessionAndRespond(req, res, next, 200, {
      status: "success",
      message: "Cambiado de negocio exitosamente",
      user: req.session.user,
      payload: req.session.user,
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

    const userPayload = await authService.getCurrentUser(req.session.user);

    if (!userPayload) {
      req.session.destroy();
      res.clearCookie("connect.sid");
      return res.status(401).json({
        status: "fail",
        message: "El usuario ya no existe o su cuenta fue eliminada",
      });
    }

    // Inyectar originalUser para impersonación
    userPayload.originalUser = req.session.originalUser || null;

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

