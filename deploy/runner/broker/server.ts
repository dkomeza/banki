import type { Identity } from "./github";
import type { LinearTokens } from "./linear-tokens";
import { redact } from "./redact";

// What the broker answers on its Unix socket (ADR-0012). Only the runner's
// container and the Dashboard's (ADR-0015) mount the socket's volume, and they
// reach nothing else of the broker's: the keys stay here, and only tokens go
// out.
//
//   GET    /github/token        an installation token, as plain text, for `gh` and git
//   GET    /github/identity     {name, email}: the App's bot, which Stages commit as
//   POST   /linear/tokens       {id, token, revokeAt}: a new Linear token for one Stage
//   DELETE /linear/tokens/<id>  revokes it, when the Stage ends
//
// A failure answers 502 with {error}, and is logged, both without any key,
// secret or token in them.

export type Services = {
  githubToken: () => Promise<string>;
  identity: () => Promise<Identity>;
  linear: LinearTokens;
  /** Everything an error must never show: the keys, the secret, every token handed out. */
  secrets: () => string[];
  log: (line: string) => void;
};

const json = (body: unknown, status = 200) => Response.json(body, { status });
const LINEAR_TOKEN = /^\/linear\/tokens\/([0-9a-f-]{1,64})$/;

export function handler(services: Services): (request: Request) => Promise<Response> {
  return async (request) => {
    const { pathname } = new URL(request.url);
    const route = `${request.method} ${pathname}`;
    try {
      if (route === "GET /github/token") {
        return new Response(await services.githubToken(), {
          headers: { "Content-Type": "text/plain" },
        });
      }
      if (route === "GET /github/identity") return json(await services.identity());
      if (route === "POST /linear/tokens") {
        const issued = await services.linear.issue();
        services.log(
          `Issued Linear token ${issued.id}, to be revoked by ${issued.revokeAt.toISOString()}`,
        );
        return json(issued);
      }
      const ending = LINEAR_TOKEN.exec(pathname);
      if (request.method === "DELETE" && ending?.[1] !== undefined) {
        const id = ending[1];
        if ((await services.linear.end(id)) === "unknown") {
          return json({ error: `no live Linear token ${id}` }, 404);
        }
        services.log(`Revoked Linear token ${id}: its Stage ended`);
        return new Response(null, { status: 204 });
      }
      return json({ error: `no route ${route}` }, 404);
    } catch (error) {
      const message = redact(
        `${route} failed: ${error instanceof Error ? error.message : String(error)}`,
        services.secrets(),
      );
      services.log(message);
      return json({ error: message }, 502);
    }
  };
}
