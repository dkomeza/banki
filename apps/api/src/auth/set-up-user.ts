import { generateId } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import type { UserRepository } from "../repositories/user";

/**
 * Does Setup's one write: creates the User with their Email and Password,
 * unless a User already exists. The Setup page and `banki setup` both come
 * through here. It needs no better-auth instance (and so no auth secret): the
 * ids and the Password hash are better-auth's defaults, the ones its own
 * sign-in reads.
 *
 * `email` is expected already parsed by the shared `Email` schema (trimmed and
 * lowercased), and `password` by the shared `Password` schema.
 */
export async function setUpUser(
  users: UserRepository,
  { email, password }: { email: string; password: string },
): Promise<"created" | "already_set_up"> {
  return users.createWithPassword({
    userId: generateId(),
    accountId: generateId(),
    email,
    passwordHash: await hashPassword(password),
  });
}
