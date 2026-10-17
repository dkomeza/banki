import { parseConfig } from "./config";

// The Docker HEALTHCHECK: asks the API in this container for /api/health and
// exits 0 only on a 2xx answer. It reads PORT the way the server does, so the
// two agree on the port without the Dockerfile repeating the default.

const TIMEOUT_MS = 3000;

try {
  const { port } = parseConfig(process.env);
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    console.error(`Unhealthy: /api/health answered HTTP ${res.status}`);
    process.exit(1);
  }
} catch (error) {
  console.error(`Unhealthy: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
