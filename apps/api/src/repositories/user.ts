import { and, eq, ne } from "drizzle-orm";
import type { Queryable } from "../db/database";
import { auth_account, auth_session, user } from "../db/schema";

/**
 * better-auth requires a `name` on every User. Banki never asks for one or
 * shows it, so the User gets this fixed placeholder.
 */
export const USER_NAME_PLACEHOLDER = "Banki User";

/** better-auth's provider id for an Email-and-Password account. */
const CREDENTIAL_PROVIDER = "credential";

export type UserRepository = ReturnType<typeof createUserRepository>;

const credentialAccountOf = (userId: string) =>
  and(
    eq(auth_account.userId, userId),
    eq(auth_account.providerId, CREDENTIAL_PROVIDER),
    eq(auth_account.accountId, userId),
  );

export function createUserRepository(db: Queryable) {
  return {
    /** Whether Setup has created the User. */
    exists(): boolean {
      return db.select({ id: user.id }).from(user).limit(1).get() !== undefined;
    },

    /** The installation's one User, if Setup has created it. */
    find(): { id: string; email: string } | undefined {
      return db.select({ id: user.id, email: user.email }).from(user).limit(1).get();
    },

    /**
     * Creates the User and their credential account in one transaction, unless
     * a User already exists. The write lock is taken before the check, so two
     * concurrent Setups (even from different processes) create one User.
     */
    createWithPassword({
      userId,
      accountId,
      email,
      passwordHash,
      now = new Date(),
    }: {
      userId: string;
      accountId: string;
      email: string;
      passwordHash: string;
      now?: Date;
    }): "created" | "already_set_up" {
      return db.transaction(
        (tx) => {
          if (tx.select({ id: user.id }).from(user).limit(1).get() !== undefined) {
            return "already_set_up";
          }
          tx.insert(user)
            .values({
              id: userId,
              name: USER_NAME_PLACEHOLDER,
              email,
              // Banki never sends mail, so there is nothing to verify (ADR-0006).
              emailVerified: true,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          tx.insert(auth_account)
            .values({
              id: accountId,
              // better-auth links a credential account to the User through its own id.
              accountId: userId,
              providerId: CREDENTIAL_PROVIDER,
              userId,
              password: passwordHash,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          return "created";
        },
        { behavior: "immediate" },
      );
    },

    /**
     * Sets the User's Password and signs out every device by deleting all of
     * their auth sessions, both or neither.
     */
    setPasswordAndSignOutEverywhere(userId: string, passwordHash: string, now = new Date()) {
      db.transaction(
        (tx) => {
          const updated = tx
            .update(auth_account)
            .set({ password: passwordHash, updatedAt: now })
            .where(credentialAccountOf(userId))
            .returning({ id: auth_account.id })
            .all();
          if (updated.length === 0) {
            throw new Error(`The User ${userId} has no credential account`);
          }
          tx.delete(auth_session).where(eq(auth_session.userId, userId)).run();
        },
        { behavior: "immediate" },
      );
    },

    /** The hash of the User's Password, if they have a credential account. */
    passwordHash(userId: string): string | undefined {
      return (
        db
          .select({ password: auth_account.password })
          .from(auth_account)
          .where(credentialAccountOf(userId))
          .get()?.password ?? undefined
      );
    },

    /**
     * Changes the User's Email, unless another User signs in with it. `email`
     * is expected already parsed by the shared `Email` schema. Auth sessions
     * are left alone, so every device stays signed in.
     */
    changeEmail(userId: string, email: string, now = new Date()): "changed" | "taken" {
      return db.transaction(
        (tx) => {
          const taken = tx
            .select({ id: user.id })
            .from(user)
            .where(and(eq(user.email, email), ne(user.id, userId)))
            .get();
          if (taken !== undefined) return "taken";
          tx.update(user).set({ email, updatedAt: now }).where(eq(user.id, userId)).run();
          return "changed";
        },
        { behavior: "immediate" },
      );
    },
  };
}
