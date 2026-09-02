import { z } from "zod";

const objectId = z.string().regex(
  /^[0-9a-fA-F]{24}$/,
  "ID inválido (debe ser un ObjectId de MongoDB)",
);

// Compatibilidad headless histórica: businessId y slug pueden coexistir.
// Esta capa sólo valida forma; scopePublicBusiness resuelve ambos antes del
// controller y permite la request únicamente cuando identifican el mismo Business.
// No existe precedencia silenciosa entre identificadores tenant.
const tenantQuery = {
  businessId: objectId.optional(),
  slug: z.string().trim().min(1, "slug no puede estar vacío").optional(),
};

export const publicServiceListSchema = z.object({
  query: z.object(tenantQuery).strict(),
});

export const publicServiceLookupSchema = z.object({
  params: z.object({ id: objectId }).strict(),
  query: z.object(tenantQuery).strict(),
});

export const publicProfessionalDiscoverySchema = z.object({
  query: z.object({
    ...tenantQuery,
    serviceId: objectId,
  }).strict(),
});
