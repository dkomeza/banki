# The Dashboard reads Linear and GitHub through the Broker, from a container of its own

The Dashboard is a third container in the `banki-runner` project. It mounts the Runner's volume read-only, for the Dispatcher's records, the Stage logs and the tick log, and asks the Broker for Linear and GitHub tokens, as `runner status` does, for what only they know: the queue, the waits and their deployments, the closing comments and the status history. It runs from the clone of `main` on that volume, like the tick, and exits when the clone's `HEAD` moves, so Docker restarts it on the new `main`. It publishes one port on the host's `127.0.0.1`, reached only through a Pangolin resource on the homelab site, behind Pangolin's SSO. This amends ADR-0012, under which only the runner's container mounted the Broker's socket.

## Considered Options

- **A snapshot the tick writes to the volume**, so the Dashboard holds no tokens and needs no network: rejected. What it shows would be up to a tick old, and the tick would grow a second output to keep in step with `runner status`.
- **Inside the runner's container**: rejected. The Stages run branch code there with permission prompts skipped, so one could stop or replace the server, and the host's firewall drops everything from the runner's network to the host.
- **Baked into the image**: rejected. Most changes to the Dispatcher would need a rebuild by hand, or the Dashboard would describe a Dispatcher older than the one running.
- **An ssh tunnel, or Tailscale**: rejected. The tunnel works from the laptop only, and Tailscale isn't on the home server.

## Consequences

- The Dashboard can mint Linear and GitHub tokens as the runner can. It is read-only by construction: it serves only `GET`, its code makes no writes to Linear or GitHub, and its mount of the volume is read-only. It holds no secret of its own, not even the Claude token, so it takes no usage reading.
- The host's firewall rules cover its network as they cover the runner's: it reaches the internet, never the host's ports or the LAN.
- It renders text from the Stages' logs and from the issues, which is untrusted, so everything it shows is escaped, its CSP allows no inline script and no other origin, and every log line goes through the same redaction as a stop comment.
- A Stage that edits the clone between a sync and the Dashboard's restart could change what the Dashboard runs. The tick already trusts the clone as much, so that is accepted.
- Its host, `runner.banki.dkomeza.com`, sits in the Previews' namespace, so `runner` joins the reserved Slugs.
