# A real email for the single User

Supersedes the fixed internal email in ADR-0005; the rest of ADR-0005 stands (better-auth, sign-up disabled, the Setup token, the CLI password reset, scrypt, no cookie cache).

Setup asks for an email along with the Password, and signing in asks for both. The email is only the identifier the User signs in with: Banki never sends mail to it and never verifies it. We chose this over ADR-0005's hidden `owner@banki.local` because it is the shape a future multi-user or SaaS Banki needs anyway (the `user` row already carries a real email, so nothing has to be migrated or explained later), and because password managers save and fill an email-plus-password pair without tricks such as a hidden username field.

## Consequences

- The sign-in form has an email field. A wrong email and a wrong Password get the same error, so the form doesn't reveal which email is set up.
- The email is stored trimmed and lowercased.
- Changing the email, like changing the Password, belongs to the Settings page (BAN-9). The CLI reset still needs no email, since there is exactly one User.
