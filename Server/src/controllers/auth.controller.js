import * as authService from "../services/auth.service.js";

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
    req.session.user = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      businessId: user.business?._id || user.business,
      businessSlug: user.business?.slug,
    };
    req.session.save((err) => {
      if (err) return next(err);
      res.status(201).json({
        status: "succes",
        message: "login exitoso",
        user,
        payload: user,
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

    req.session.user = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      businessId: user.business?._id || user.business,
      businessSlug: user.business?.slug,
    };

    req.session.save((err) => {
      if (err) return next(err);
      res.status(200).json({
        status: "success",
        message: "Login con Google exitoso",
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

    res.status(200).json({
      status: "success",
      user: req.session.user,
      payload: req.session.user,
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
