import { z } from "zod";

const objectId = z.string().regex(
  /^[0-9a-fA-F]{24}$/,
  "ID inválido (debe ser un ObjectId de MongoDB)",
);

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
