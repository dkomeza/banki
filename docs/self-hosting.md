# Self-hosting

Running your own Banki with Docker Compose: where to open it, HTTPS, where the data lives, and its configuration.

## Starting it

Run it with Docker Compose from a clone of this repo:

```sh
docker compose up -d
```

That builds two images and starts them behind one origin: `web` (Caddy) serves the app and passes everything under `/api` to `api` (the Bun API). Only `web` is reachable from the host, on port 8080, so open <http://localhost:8080>. Docker reports `api` healthy once `/api/health` answers, and `web` starts only after that.

On the first run, find the Setup link in the API's logs and open it (see [First run](development.md#first-run)):

```sh
docker compose logs api | grep setupUrl
```

The link is on `BANKI_ORIGIN`, so it only works once that is right for you (below). If you open Banki at another address, take the token from the link and paste it into the Setup page.

Never publish the API's port (no `ports:` for `api` in a `compose.override.yaml`). The API trusts the `X-Forwarded-For` header for client IPs, in its rate limits and logs, because only `web` can reach it.

To use another port, set `BANKI_PORT` in a `.env` file next to `compose.yaml` (it defaults to 8080):

```sh
BANKI_PORT=9000
```

The port is open on every network interface of the host. To make Banki reachable only from the host itself, for example when a reverse proxy on the same machine sits in front of it, prefix the port with `127.0.0.1:`, as in `BANKI_PORT=127.0.0.1:8080`.

## The address you open Banki at

Banki refuses to sign in from any address but `BANKI_ORIGIN` (the API's `ORIGIN`; `web` reads it too, for HSTS), which defaults to `http://localhost:8080`. Set it in `.env` to the exact address in your browser's address bar, without a path, whenever that isn't `http://localhost:8080`: when you open Banki by another host name or IP, on a different `BANKI_PORT`, or through an HTTPS reverse proxy:

```sh
BANKI_PORT=9000
BANKI_ORIGIN=http://192.168.1.20:9000
```

```sh
# Behind your own HTTPS proxy
BANKI_ORIGIN=https://banki.example.com
```

With an `https:` origin the sign-in cookie is `__Host-better-auth.session_token`, which is `Secure`, has `Path=/` and has no `Domain` (see [Sign-in cookies beside the Previews](infra/previews.md#sign-in-cookies-beside-the-previews)), and `web` sends HSTS (see [Security headers](#security-headers)). A sign-in from the wrong address fails, and the API logs a warning naming both addresses.

## HTTPS

The web container speaks plain HTTP only. For HTTPS, put your own reverse proxy (Caddy, nginx, Traefik and so on) in front of it to terminate TLS, and set `BANKI_ORIGIN` to its `https://` address. Browsers only offer to install Banki as an app (a PWA) over HTTPS or on `localhost`.

Banki limits sign-in and Setup attempts per client IP. Behind your own proxy every request comes from the proxy's address, so tell `web` to believe the `X-Forwarded-For` your proxy sends by listing the proxy's IPs or CIDR ranges, space-separated, in `BANKI_TRUSTED_PROXIES`:

```sh
BANKI_TRUSTED_PROXIES=172.18.0.1 10.0.0.0/24
```

List only your proxies, never a broad private range that also covers clients. Unset, `web` trusts no one and uses the address each connection comes from.

## Security headers

`web` sends these on every response, the API's included:

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`: Banki loads nothing from anywhere but its own origin, and can't be framed.
- `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`.
- `Strict-Transport-Security: max-age=31536000`, only when `BANKI_ORIGIN` starts with `https://`, so browsers keep to HTTPS for a year. It leaves out `includeSubDomains` and `preload`, which would reach past Banki. Over plain HTTP it isn't sent.

`bun run dev` (Vite) sends none of them.

## Installing Banki as an app

Banki is a Progressive Web App: your browser can install it, so it opens in its own window, or from your home screen, like any other app. Browsers offer this only over HTTPS or on `localhost`. There is no Install button in Banki; use the browser's own:

- **Chrome or Edge on a computer:** the install icon at the right of the address bar, or the menu's Install page as app (Chrome: Cast, save and share).
- **Safari on a Mac:** File, Add to Dock.
- **Safari on an iPhone or iPad:** Share, Add to Home Screen.
- **Chrome on Android:** the menu's Add to Home screen, then Install.

Banki works online only: opened without a connection, the app shows the browser's own offline page. Its theme (System, Light or Dark, in the account menu) is kept per device.

## Where the data lives

Everything Banki stores is in the `banki-data` volume, mounted at `/data` in the `api` container (see [API configuration](#api-configuration) for its layout). Compose names it `banki_banki-data`, and `docker volume inspect banki_banki-data` shows where it is on the host. It survives restarts, rebuilds and `docker compose down`; only `docker compose down -v` deletes it. To back it up, follow the note under [API configuration](#api-configuration), stopping the API with `docker compose stop api` first.

To keep the data in a directory of your own instead (a bind mount), make the directory owned by uid 1000 first, since the API runs as that user and can't write to it otherwise:

```sh
mkdir -p /srv/banki
sudo chown 1000:1000 /srv/banki
```

Then mount it over `/data` in a `compose.override.yaml` next to `compose.yaml`, which Compose reads automatically:

```yaml
services:
  api:
    volumes:
      - /srv/banki:/data
```

## Setting up from a shell in Docker

Instead of opening the Setup link, run `banki setup` in a one-off `api` container before the first `docker compose up`, against the empty volume:

```sh
printf '%s\n' "$PASSWORD" | docker compose run --rm -T api bun run banki setup --email you@example.com --password-stdin
docker compose up -d
```

Or interactively, answering its questions: `docker compose run --rm api bun run banki setup`. The API then starts set up and logs no Setup token. See [Setting up from a shell](development.md#setting-up-from-a-shell). `docker compose run --rm -T api bun run banki seed` loads the [Seed data](development.md#seed-data) the same way.

## Resetting the Password in Docker

```sh
docker compose exec -it api bun run banki reset-password
```

Or, from a script, `printf '%s\n' "$NEW_PASSWORD" | docker compose exec -T api bun run banki reset-password --password-stdin`. Either way it signs out every device. See [Resetting the Password](development.md#resetting-the-password).

## Upgrading

```sh
git pull && docker compose up -d --build
```

That rebuilds both images and recreates the containers. The API applies any new migrations on start, before it accepts requests, and the data volume stays as it is.

## API configuration

The API reads these environment variables at startup and exits with code 1, listing what's wrong, if any is invalid. An empty variable counts as unset.

| Variable         | Default                 | What it sets                                                                                                                                                                                                                                                                    |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATA_DIR`       | `/data`                 | The data directory. A relative path is resolved against the working directory.                                                                                                                                                                                                  |
| `PORT`           | `3000`                  | The port the API listens on, 1 to 65535                                                                                                                                                                                                                                         |
| `LOG_FORMAT`     | `json`                  | `json` for JSON lines, `pretty` for terminal-friendly text                                                                                                                                                                                                                      |
| `LOG_LEVEL`      | `info`                  | The lowest level logged: `debug`, `info`, `warning` or `error`. Health checks log at `debug`                                                                                                                                                                                    |
| `ORIGIN`         | `http://localhost:5173` | The address the User opens Banki at: an `http:` or `https:` URL with no path, query or hash. Signing in is refused from any other origin, and the sign-in cookie is `__Host-` (`Secure`, `Path=/`, no `Domain`) exactly when it is `https:`. The default is the Vite dev server |
| `AUTH_SECRET`    | none                    | The secret sign-in cookies are signed with, at least 32 characters. Unset, the API generates one into `<DATA_DIR>/auth-secret` on the first start. Changing it signs out every device                                                                                           |
| `ENCRYPTION_KEY` | none                    | The key the stored OpenRouter API key is encrypted with: 32 random bytes as base64url (43 characters). Unset, the API generates one into `<DATA_DIR>/encryption-key` on the first start. Changing it makes the stored API key unreadable, and it has to be entered again        |

The data directory holds everything Banki stores:

```text
<DATA_DIR>/
├── banki.db        SQLite database (with banki.db-wal and banki.db-shm beside it while running)
├── auth-secret     the secret sign-in cookies are signed with, unless AUTH_SECRET is set (mode 0600)
├── encryption-key  the key the API key is encrypted with, unless ENCRYPTION_KEY is set (mode 0600)
├── imports/        an unconfirmed Import's zip images, one folder per Import, gone once it is confirmed or 24 hours old
└── uploads/        the Images, byte for byte as uploaded, one file each (<id>.<ext>)
```

On startup the API creates whatever is missing, then applies any migrations the database doesn't have yet before it accepts requests. An `auth-secret` that is empty, shorter than 32 characters or unreadable fails startup; delete it to generate a new one, which signs out every device. An `encryption-key` that isn't 32 bytes as base64url, or is unreadable, fails startup too; delete it to generate a new one, after which the stored API key reads as "Can't be read" in Settings and has to be entered again. Nothing else is lost (ADR-0014).

To back up Banki, stop the API first and then copy the whole directory, or take an atomic snapshot of the filesystem it lives on. Copying it while the API runs can catch `banki.db` and `banki.db-wal` at different moments and give a backup that doesn't match either. A backup must keep `encryption-key` with `banki.db`: the API key in the database can only be read with it, so a database restored without it loses the API key. A backup includes `auth-secret` and `encryption-key`, so keep it as private as the installation itself.
