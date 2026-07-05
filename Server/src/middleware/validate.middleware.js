import { ZodError } from "zod";

export const validate = (schema) => (req, res, next) => {
  try {
    // Validamos req.body, req.query y req.params contra el esquema Zod
    schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
  } catch (error) {
    console.error("VALIDATION ERROR CAUGHT:", error);
    if (error instanceof ZodError) {
      // Zod arroja un error estructurado si falla la validación
      const formattedErrors = (error.errors || error.issues || []).map((err) => {
        // Remover "body", "query" o "params" del path para dejar solo el nombre del campo
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

