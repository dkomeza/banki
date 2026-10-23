import { z } from "zod";

/** The Password length Banki accepts, everywhere a Password is set or typed. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** The Email the User signs in with, stored trimmed and lowercased (ADR-0006). */
export const Email = z.string().trim().toLowerCase().pipe(z.email("Expected an email address"));

export const Password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Expected at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Expected at most ${PASSWORD_MAX_LENGTH} characters`);

/** The body of `GET /api/setup`: whether Setup is done. */
export const SetupStatus = z.object({ setUp: z.boolean() });
export type SetupStatus = z.infer<typeof SetupStatus>;

/** The body of `POST /api/setup`. */
export const SetupRequest = z.object({
  token: z.string(),
  email: Email,
  password: Password,
});
export type SetupRequest = z.input<typeof SetupRequest>;

/** The body of `GET /api/me`: the signed-in User. */
export const MeResponse = z.object({ email: z.string() });
export type MeResponse = z.infer<typeof MeResponse>;

/** The body of `POST /api/me/email`: the new Email and the current Password. */
export const ChangeEmailRequest = z.object({
  email: Email,
  password: z.string().max(PASSWORD_MAX_LENGTH),
});
export type ChangeEmailRequest = z.input<typeof ChangeEmailRequest>;
