import logger from "../config/logger.js";
import { AppError } from "../utils/appError.js";

const handleCastErrorDB = (err) => {
  const message = `Valor inválido '${err.value}' para el campo '${err.path}'.`;
  return new AppError(message, 400, "INVALID_ID_ERROR");
};

const handleDuplicateFieldsDB = (err) => {
  const field = Object.keys(err.keyValue)[0];
  const value = err.keyValue[field];

  let message = `El valor '${value}' para el campo '${field}' ya existe en el sistema.`;
  let code = "DUPLICATE_FIELD_ERROR";

  if (
    err.message.includes("appointments") ||
    (err.keyValue.worker && err.keyValue.startTime)
  ) {
    message =
      "El horario seleccionado ya se encuentra reservado por otro cliente.";
    code = "DOUBLE_BOOKING_ERROR";
  }

  return new AppError(message, 409, code);
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => el.message);
  const message = `Datos de formulario inválidos: ${errors.join(". ")}`;
  return new AppError(message, 400, "MONGOOSE_VALIDATION_ERROR");
};

const sendErrorDev = (err, req, res) => {
  logger.error(
    `[DEV ERROR] ${err.statusCode} - ${err.code} - ${err.message}\nStack: ${err.stack}`,
  );

  return res.status(err.statusCode).json({
    status: err.status || "error",
    statusCode: err.statusCode,
    code: err.code,
    message: err.message,
    stack: err.stack,
    error: err,
  });
};

const sendErrorProd = (err, req, res) => {
  if (err.isOperational) {
    logger.warn(`[OP ERROR] ${err.statusCode} - ${err.code} - ${err.message}`);
    return res.status(err.statusCode).json({
      status: "fail",
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
    });
  }

  logger.error(
    `[SYSTEM ERROR] 500 - INTERNAL_ERROR - ${err.message}\nStack: ${err.stack}`,
  );

  return res.status(500).json({
    status: "error",
    statusCode: 500,
    code: "INTERNAL_SERVER_ERROR",
    message:
      "Ocurrió un error interno en el servidor. Por favor, intente más tarde.",
  });
};

const handleError = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.code = err.code || "INTERNAL_SERVER_ERROR";

  let error = { ...err };
  error.message = err.message;
  error.stack = err.stack;

  if (err.name === "CastError") error = handleCastErrorDB(error);
  if (err.code === 11000) error = handleDuplicateFieldsDB(error);
  if (err.name === "ValidationError") error = handleValidationErrorDB(error);

  const environment = process.env.NODE_ENV || "development";

  if (environment === "development") {
    sendErrorDev(error, req, res);
  } else {
    sendErrorProd(error, req, res);
  }
};

export default handleError;
