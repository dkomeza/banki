# better-auth with a fixed internal email

The MVP's single-password login is built on better-auth, not on a hand-rolled session cookie, because a future SaaS needs real accounts and better-auth's `user` table is the User row from ADR-0001. better-auth requires a unique email on every user, so the single User gets a fixed internal email (e.g. `owner@banki.local`) that is never shown. Sign-up is disabled, and the login screen sends that email along with the typed password. The first password is set on a first-run setup screen, which requires a one-time setup token the API prints to its logs on first start, so whoever reaches a freshly exposed instance first can't claim it. A CLI command resets a forgotten password, since there's no email to send a reset link to.

## Consequences

- better-auth owns the `user`, `session`, `account` and `verification` tables. Its CLI generates them as a Drizzle schema we keep in the repo and migrate with drizzle-kit.
- better-auth is pinned to an exact version, because minor releases have shipped breaking changes (1.7.0).
- The password hash stays better-auth's default scrypt, and the cookie cache stays off so revoking a session takes effect immediately.
