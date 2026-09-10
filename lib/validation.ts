import { z } from 'zod';

export const idSchema = z.uuid();
export const documentSchema = z
  .object({
    id: idSchema,
    title: z.string().max(300),
    content: z.string().max(1_000_000),
    folder: z.string().trim().min(1).max(80),
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
    pinned: z.boolean(),
  deletedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
    revision: z.number().int().nonnegative(),
    attachments: z.array(idSchema).max(100),
    conflictOf: idSchema.optional(),
  })
  .strict();

export const mutationSchema = z
  .object({ mutationId: idSchema, note: documentSchema })
  .strict();
export type Mutation = z.infer<typeof mutationSchema>;
