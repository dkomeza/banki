# Separate frontend and backend deployables

The frontend (a React SPA) and the backend (a Hono API) are separate apps in one monorepo, built and deployed independently, rather than one server-rendered meta-framework app. The app sits behind a password and is an online-only PWA, so server rendering buys little, while a standalone API is what later clients (offline sync, mobile, SaaS) will talk to. For self-hosting, both run behind one origin: the web container serves the SPA and proxies `/api/*` to the API container, so cookies work without CORS. A future SaaS may split them across origins (`app.` and `api.` subdomains), so the API must not assume a shared origin anywhere except its cookie and CORS configuration.

## Considered Options

- **Next.js or another SSR meta-framework** (the old prototype used Next.js): rejected, because server rendering adds little behind a login and blurs the API boundary. The prototype's build-time public folder also clashed with serving uploads at runtime.
- **One container serving both the SPA and the API:** simpler for self-hosters, but rejected to keep the two deployables genuinely separate from day one.
