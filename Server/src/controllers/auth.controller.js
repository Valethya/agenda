import * as authService from "../services/auth.service.js";
import { UnauthorizedError } from "../utils/appError.js";

const saveSessionAndRespond = (req, res, next, statusCode, body) => {
  req.session.save((err) => {
    if (err) return next(err);
    res.status(statusCode).json(body);
  });
};

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
    res.status(201).json({ status: "succes", message: "usuario creado correctamente", payload: user });
  } catch (error) { next(error); }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await authService.login(email, password);
    handleLoginResult(req, res, next, user, "Login exitoso");
  } catch (error) { next(error); }
};

export const logout = (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("connect.sid");
    return res.status(200).json({ status: "success", message: "Logout exitoso" });
  });
};

export const googleLogin = async (req, res, next) => {
  try {
    const user = await authService.loginWithGoogle(req.body.idToken);
    handleLoginResult(req, res, next, user, "Login con Google exitoso");
  } catch (error) { next(error); }
};

export const selectMembership = async (req, res, next) => {
  try {
    if (!req.session.tempUser) {
      throw new UnauthorizedError("No hay una sesión temporal activa. Inicia sesión nuevamente.");
    }

    const sessionUser = await authService.selectMembership(
      req.session.tempUser.id,
      req.body.membershipId,
    );

    req.session.user = sessionUser;
    delete req.session.tempUser;

    saveSessionAndRespond(req, res, next, 200, {
      status: "success",
      message: "Negocio seleccionado con éxito",
      user: sessionUser,
      payload: sessionUser,
    });
  } catch (error) { next(error); }
};

export const switchBusiness = async (req, res, next) => {
  try {
    if (!req.session.user) throw new UnauthorizedError("Inicia sesión para cambiar de negocio");

    const updates = await authService.switchBusiness(req.session.user.id, req.body.businessId);
    req.session.user.businessId = updates.businessId;
    req.session.user.businessSlug = updates.businessSlug;

    if (updates.globalRole === "superadmin") {
      req.session.user.role = "superadmin";
    } else if (updates.tenantRole) {
      // Copia de contexto para UI; las políticas runtime no confían en este campo.
      req.session.user.role = updates.tenantRole;
    }

    saveSessionAndRespond(req, res, next, 200, {
      status: "success",
      message: "Cambiado de negocio exitosamente",
      user: req.session.user,
      payload: req.session.user,
    });
  } catch (error) { next(error); }
};

export const getCurrentUser = async (req, res, next) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ status: "fail", message: "No hay sesión activa" });
    }

    const result = await authService.getCurrentUser(req.session.user);
    if (result.type !== "valid") {
      req.session.destroy(() => {});
      res.clearCookie("connect.sid");
      return res.status(401).json({
        status: "fail",
        message: result.type === "invalid_tenant"
          ? "La sesión del negocio ya no posee una membresía activa"
          : "El usuario ya no existe o su cuenta no está disponible",
      });
    }

    const userPayload = result.payload;
    userPayload.originalUser = req.session.originalUser || null;

    // Mantener la copia de presentación sincronizada con el estado vigente.
    req.session.user = {
      ...req.session.user,
      id: userPayload.id,
      firstName: userPayload.firstName,
      lastName: userPayload.lastName,
      email: userPayload.email,
      role: userPayload.role,
      businessId: userPayload.businessId,
      businessSlug: userPayload.businessSlug,
    };

    res.status(200).json({ status: "success", user: userPayload, payload: userPayload });
  } catch (error) { next(error); }
};

export const forgotPassword = async (req, res, next) => {
  try {
    await authService.sendResetPasswordEmail(req.body.email);
    res.status(200).json({
      status: "success",
      message: "Si el correo está registrado en nuestro sistema, recibirás un correo de recuperación en breve.",
    });
  } catch (error) { next(error); }
};

export const resetPassword = async (req, res, next) => {
  try {
    await authService.resetPassword(req.body.token, req.body.newPassword);
    res.status(200).json({ status: "success", message: "Contraseña restablecida correctamente" });
  } catch (error) { next(error); }
};

export const changePassword = async (req, res, next) => {
  try {
    await authService.updatePassword(req.session.user.id, req.body.currentPassword, req.body.newPassword);
    res.status(200).json({ status: "success", message: "Contraseña cambiada exitosamente" });
  } catch (error) { next(error); }
};
