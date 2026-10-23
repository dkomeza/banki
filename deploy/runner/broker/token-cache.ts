// The broker's GitHub installation token (ADR-0012): one at a time, shared by
// every `gh` call and git push. GitHub's last an hour. A new one is minted
// once under 15 minutes remain, so a token handed out is good for at least
// that long, and a leaked one dies within the hour.

export type ExpiringToken = { token: string; expiresAt: Date };

/** A token is handed out only while more than this much of it remains. */
export const REFRESH_BEFORE_MS = 15 * 60_000;
/** When minting fails, the old token still goes out while more than this remains. */
const LAST_RESORT_MS = 60_000;

const remaining = (token: ExpiringToken, now: Date) => token.expiresAt.getTime() - now.getTime();

export class TokenCache {
  #current: ExpiringToken | undefined;
  #minting: Promise<ExpiringToken> | undefined;

  constructor(
    private readonly mint: () => Promise<ExpiringToken>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The current token, or a new one when it is missing or under 15 minutes from expiring. */
  async get(): Promise<ExpiringToken> {
    const current = this.#current;
    if (current !== undefined && remaining(current, this.now()) > REFRESH_BEFORE_MS) {
      return current;
    }
    // Callers who ask while a mint is under way share it.
    this.#minting ??= this.mint().finally(() => {
      this.#minting = undefined;
    });
    try {
      const minted = await this.#minting;
      this.#current = minted;
      return minted;
    } catch (error) {
      if (current !== undefined && remaining(current, this.now()) > LAST_RESORT_MS) return current;
      throw error;
    }
  }
}
