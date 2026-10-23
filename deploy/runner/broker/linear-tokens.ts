// The Linear tokens the broker has issued (ADR-0012), one per Stage. Each is
// minted with the client-credentials grant when the Stage starts and revoked
// when it ends. Whatever is still live 4 hours after issue is revoked anyway,
// which covers a Stage that crashed before ending its own. They are held in
// memory only: a broker restart forgets them, and those live out Linear's 30
// days.

/** A token is revoked this long after issue, whether or not its Stage ended it. */
export const MAX_AGE_MS = 4 * 3_600_000;

export type IssuedToken = { id: string; token: string; revokeAt: Date };

type Live = { token: string; issuedAt: Date };

export class LinearTokens {
  readonly #live = new Map<string, Live>();
  readonly #mint: () => Promise<string>;
  readonly #revoke: (token: string) => Promise<void>;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: {
    mint: () => Promise<string>;
    revoke: (token: string) => Promise<void>;
    now?: () => Date;
    newId?: () => string;
  }) {
    this.#mint = options.mint;
    this.#revoke = options.revoke;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => crypto.randomUUID());
  }

  /** A new token, with the ID its Stage ends it by. */
  async issue(): Promise<IssuedToken> {
    const token = await this.#mint();
    const issuedAt = this.#now();
    const id = this.#newId();
    this.#live.set(id, { token, issuedAt });
    return { id, token, revokeAt: new Date(issuedAt.getTime() + MAX_AGE_MS) };
  }

  /**
   * Revokes the token `id` names and forgets it, or does nothing when this
   * broker didn't issue it or it has gone already. A failed revoke keeps it,
   * for the sweep to try again.
   */
  async end(id: string): Promise<"revoked" | "unknown"> {
    const live = this.#live.get(id);
    if (live === undefined) return "unknown";
    await this.#revoke(live.token);
    this.#live.delete(id);
    return "revoked";
  }

  /** Revokes every token issued 4 hours ago or more. A failure is tried again on the next sweep. */
  async sweep(): Promise<{ revoked: string[]; failed: string[] }> {
    const now = this.#now().getTime();
    const revoked: string[] = [];
    const failed: string[] = [];
    for (const [id, live] of this.#live) {
      if (now - live.issuedAt.getTime() < MAX_AGE_MS) continue;
      try {
        await this.#revoke(live.token);
        this.#live.delete(id);
        revoked.push(id);
      } catch {
        failed.push(id);
      }
    }
    return { revoked, failed };
  }

  /** How many tokens are live. */
  live(): number {
    return this.#live.size;
  }

  /** The live tokens' values, which nothing the broker logs or returns on an error may contain. */
  values(): string[] {
    return [...this.#live.values()].map((live) => live.token);
  }
}
