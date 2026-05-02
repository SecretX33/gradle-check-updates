import { z } from "zod";

export const ProjectConfigSchema = z
  .object({
    target: z.enum(["major", "minor", "patch"]).optional(),
    pre: z.boolean().optional(),
    cooldown: z.number().int().min(0).optional(),
    allowDowngrade: z.boolean().optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
  })
  .strict();

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const UserConfigSchema = ProjectConfigSchema.extend({
  cacheDir: z.string().optional(),
  noCache: z.boolean().optional(),
}).strict();

export type UserConfig = z.infer<typeof UserConfigSchema>;

export const CredentialEntrySchema = z.union([
  z
    .object({
      url: z.string().url(),
      username: z.string().min(1),
      password: z.string().min(1),
    })
    .strict(),
  z.object({ url: z.string().url(), token: z.string().min(1) }).strict(),
]);

export type CredentialEntry = z.infer<typeof CredentialEntrySchema>;

export const CredentialsFileSchema = z
  .object({ repositories: z.array(CredentialEntrySchema) })
  .strict();

export type CredentialsFile = z.infer<typeof CredentialsFileSchema>;
