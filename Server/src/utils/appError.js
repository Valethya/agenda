export class AppError extends Error {
  constructor(message, statusCode, code = "OPERATIONAL_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Recurso no encontrado") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(message = "Error de validación en los datos proporcionados") {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflicto de recursos en la solicitud") {
    super(message, 409, "CONFLICT_ERROR");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "No autorizado para realizar esta acción") {
    super(message, 401, "UNAUTHORIZED_ERROR");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Acceso prohibido para este rol o recurso") {
    super(message, 403, "FORBIDDEN_ERROR");
  }
}
