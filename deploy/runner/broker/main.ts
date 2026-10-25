import { chmodSync, rmSync } from "node:fs";
import { brokerSocket, errorText, readSecret, requiredEnv, SECRETS } from "../lib/config";
import { gitHubApp } from "./github";
import { importAppKey } from "./jwt";
import { linearApp } from "./linear";
import { LinearTokens } from "./linear-tokens";
import { redact } from "./redact";
import { handler } from "./server";
import { IDLE_TIMEOUT_S } from "./timeouts";
import { TokenCache } from "./token-cache";

// The broker (ADR-0012): the one container of the Runner that holds the
// GitHub App's private key and the Linear app's client secret. It mints
// short-lived tokens from them for whoever reaches its Unix socket, which only
// the runner's container and the Dashboard's (ADR-0015) mount, and nothing
// else runs here. Neither ever sees either key.

/** How often the 4-hour-old Linear tokens are swept. */
const SWEEP_MS = 60_000;

function start() {
  try {
    const appId = requiredEnv("GITHUB_APP_ID");
    const clientId = requiredEnv("LINEAR_CLIENT_ID");
    const pem = readSecret(SECRETS.githubAppKey);
    const clientSecret = readSecret(SECRETS.linearClientSecret);
    return { appId, clientId, pem, clientSecret };
  } catch (error) {
    console.error(`Can't start: ${errorText(error)}`);
    return process.exit(1);
  }
}

const { appId, clientId, pem, clientSecret } = start();
const key = await importAppKey(pem).catch((error: unknown) => {
  console.error(`Can't start: ${errorText(error)}`);
  return process.exit(1);
});

const github = gitHubApp({ appId, key });
/** The last two installation tokens minted, both possibly still live: kept only to redact them. */
let recent: string[] = [];
const githubTokens = new TokenCache(async () => {
  const minted = await github.mintToken();
  console.log(`Minted a GitHub installation token, good until ${minted.expiresAt.toISOString()}`);
  recent = [minted.token, ...recent].slice(0, 2);
  return minted;
});
const linear = linearApp({ clientId, clientSecret });
const linearTokens = new LinearTokens({
  mint: () => linear.mint(),
  revoke: (token) => linear.revoke(token),
});

const secrets = () => [pem, clientSecret, ...recent, ...linearTokens.values()];
const log = (line: string) => console.log(redact(line, secrets()));

const socket = brokerSocket();
// A socket left by the Broker before this one would refuse the bind.
rmSync(socket, { force: true });
const handle = handler({
  githubToken: async () => (await githubTokens.get()).token,
  identity: async () => github.identity((await githubTokens.get()).token),
  linear: linearTokens,
  secrets,
  log,
});
Bun.serve({
  unix: socket,
  fetch: (request, server) => {
    // Bun's default of 10 s is shorter than one mint. Set per request: Bun
    // takes `idleTimeout` in the options only for a port.
    server.timeout(request, IDLE_TIMEOUT_S);
    return handle(request);
  },
  error: (error) => {
    log(`Request failed: ${errorText(error)}`);
    return Response.json({ error: "broker error" }, { status: 500 });
  },
});
// Both containers run as the same user, so nobody else needs it.
chmodSync(socket, 0o600);
console.log(`Minting tokens for GitHub App ${appId} and Linear app ${clientId} on ${socket}`);

setInterval(() => {
  linearTokens.sweep().then(
    ({ revoked, failed }) => {
      for (const id of revoked) log(`Revoked Linear token ${id}: 4 hours old`);
      for (const { id, error } of failed) {
        log(`Couldn't revoke Linear token ${id}, trying again in a minute: ${error}`);
      }
    },
    (error: unknown) => log(`Sweep failed: ${errorText(error)}`),
  );
}, SWEEP_MS);
