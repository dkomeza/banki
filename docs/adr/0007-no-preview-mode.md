# No preview mode: a Preview is set up with the same CLI as any installation

A Preview must start already set up, with its User's Email and Password and with Seed data. Rather than a preview mode in the API (environment variables it reads on start) or a preview-only image, the `banki` CLI gains `setup` (create the User, the headless equivalent of the Setup page) and `seed` (load Seed data into an installation with no content), and a Preview runs both against an empty data directory before the server starts. The server then finds a User, creates no Setup token and never opens Setup, exactly as on any installation that has been set up. So no installation carries a code path that variables set by mistake could switch on, previews test the very image that ships, and the `/work-issue` agents set up their local copies the same way.

This amends ADR-0005: Setup can now also be done with `banki setup`, which needs a shell in the API's container and so proves at least as much as the Setup token does.

## Considered Options

- **Environment variables the API reads on start** (create the User if there is none, then seed): rejected, because every installation would then skip Setup, with a Password taken from its environment, whenever those variables are set by mistake.
- **A preview-only image or entrypoint**: rejected, because a Preview would no longer test the image that ships.

## Consequences

- `banki setup` refuses when the installation is already set up, and `banki seed` refuses unless it is set up and the User has no content yet, so neither can damage a real installation.
- The Preview's Email and Password live with the pull agent on the home server (BAN-79), not in GitHub, and reach `banki setup` on stdin. Every Preview shares them. A Preview runs its pull request's code, which sees that Password, so it is used for Previews only and rotated if it leaks.
- `AUTH_SECRET` stays unset in a Preview, so each rebuild generates its own; with a fresh database on every push, signing in again after a push is expected.
- Seed data is written in TypeScript through the repositories, so a schema change that breaks it fails the typecheck, and a test runs it against a freshly migrated database. An issue that adds something the UI shows adds Seed data for it in the same pull request.
