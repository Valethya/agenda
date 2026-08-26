import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "membershipId inválido");

export const updateTeamMembershipSchema = z.object({
  params: z.object({
    membershipId: objectId,
  }).strict(),
  body: z.object({
    role: z.enum(["admin", "worker"]).optional(),
    isBookable: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: "Debe indicar al menos un campo para actualizar",
    }),
});
