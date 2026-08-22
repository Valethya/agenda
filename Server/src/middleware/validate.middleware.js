import { ZodError } from "zod";

export const validate = (schemaOrResolver, options = {}) => (req, res, next) => {
  try {
    const schema = typeof schemaOrResolver === "function" && typeof schemaOrResolver.parse !== "function"
      ? schemaOrResolver(req)
      : schemaOrResolver;

    // Validamos req.body, req.query y req.params contra el esquema Zod.
    const parsed = schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    // Opt-in: las fronteras que necesiten garantías de allowlist pueden obligar
    // al controller a consumir exactamente el body parseado/transformado.
    if (options.assignBody && parsed.body !== undefined) {
      req[options.assignBody] = parsed.body;
    }
  } catch (error) {
    if (error instanceof ZodError) {
      const formattedErrors = (error.errors || error.issues || []).map((err) => {
        const fieldPath = err.path.slice(1).join(".");
        return {
          field: fieldPath || err.path[0],
          message: err.message,
        };
      });

      return res.status(400).json({
        status: "fail",
        statusCode: 400,
        code: "VALIDATION_ERROR",
        message: "Algunos datos ingresados son incorrectos o están incompletos.",
        errors: formattedErrors,
      });
    }

    return next(error);
  }

  return next();
};

export default validate;
