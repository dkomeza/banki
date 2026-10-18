# Research: how per-PR preview URLs reach the home server

Ticket: BAN-78 (parent map BAN-77, "Per-PR UI previews"). Researched 2026-10-18.
Throwaway branch `research/preview-ingress`; never merged.

## Question

Each PR preview needs its own HTTPS hostname (`pr-17.preview.<domain>`), reachable
from the internet and routed to a container stack on a home server behind NAT. The
VPS ingress (not bought yet; Pangolin is the favourite) will also serve Jellyfin,
Home Assistant and other home services, so previews must fit into it rather than
define it. DNS is on Cloudflare; Let's Encrypt certificates are preferred. Compare
Pangolin, frp + Traefik/Caddy and Cloudflare Tunnel on certificates, dynamic routes,
fit with other services, cost and upkeep, and what could break Banki behind them.

## Recommendation

**Pangolin on a small VPS, with Cloudflare as DNS only (grey cloud).** Previews are
one more thing behind the ingress the home services already use.

1. **Certificates:** set Pangolin's Traefik to DNS-01 with a Cloudflare API token
   (`Zone:Read` + `DNS:Edit`) and `prefer_wildcard_cert: true`. Every
   `pr-N.preview.<domain>` resource is then served by one Let's Encrypt
   `*.preview.<domain>` certificate, so opening a PR never touches the LE rate limits.
2. **Routes:** there are two ways, and the choice depends on the edition:
   - **Enterprise image + free personal licence key.** Make one wildcard resource,
     `*.preview.<domain>`, pointing at one small proxy on the home server (Traefik
     with the Docker provider, or Caddy). That proxy routes by `Host` to each PR's
     `web` container using Docker labels. Pangolin needs no step per PR.
   - **Community image.** Wildcard subdomains are blocked in CE. Instead, the preview
     deploy script creates and deletes one resource per PR through the Integration
     API, or puts Blueprint Docker labels on the preview's `web` container. Each
     target can point straight at that PR's `web` container, so no proxy is needed
     at home.
3. **Isolation:** run a separate Pangolin site (a Newt / `pangolin site` container)
   for previews. Attach it only to the previews' Docker network, never to the
   Jellyfin/HA networks. Previews run unreviewed PR code, so put Pangolin auth
   (SSO or a PIN) on the preview resource(s).
4. **Banki config per preview:** set `BANKI_ORIGIN=https://pr-N.preview.<domain>`.
   List in `BANKI_TRUSTED_PROXIES` every hop that adds to `X-Forwarded-For`
   between the Pangolin site container and `web`. See the X-Forwarded-For
   section below.

**Rejected:** Cloudflare Tunnel. Its free edge certificate forces a flat scheme
(`pr-17-preview.<domain>`), or $10/month for Advanced Certificate Manager. It serves
Cloudflare's certificate rather than your Let's Encrypt one. It would be a second
ingress beside the VPS. And putting Jellyfin through Cloudflare's proxy runs into
its CDN terms.

**Viable but not preferred:** frp + Traefik. It works and is lighter, but it is a
hand-built Pangolin (Traefik on a VPS plus a tunnel) without the dashboard, SSO,
API or WireGuard. You would wire up auth for the home services yourself.

## Findings

### Pangolin (v1.24.0, 2026-09-30)

Pangolin is a dashboard and control plane in front of **Traefik on the VPS**. Its
Gerbil component terminates WireGuard, and a site agent (Newt, being renamed "Pangolin
Site" / `pangolin site up`) on the home server dials out over WireGuard. Newt is "a
fully user space WireGuard tunnel client and TCP/UDP proxy" that relays to the
configured targets [newt README]. The release notes are at [pangolin releases].

**Certificates.** The default install uses HTTP-01 [install traefik_config.yml]. For
wildcards, switch the Traefik resolver to `dnsChallenge` with `provider: cloudflare`,
give Traefik `CLOUDFLARE_DNS_API_TOKEN` (`Zone:Read`, `DNS:Edit`), and set
`prefer_wildcard_cert: true` on the domain [pangolin wildcard domains]. A wildcard
covers exactly one level, so a resource at `pr-17.preview.<domain>` needs
`*.preview.<domain>`. Pangolin works that out: `buildWildcardTls` takes the resource's
full domain and asks Traefik for `*.` + everything after the first label when
wildcard is preferred [certResolver.ts]. So all preview resources share one
`*.preview.<domain>` certificate. One open issue says the wildcard preference is not
respected for *deep* domains on **private** resources [pangolin#3875]. That doesn't
touch public resources.

**Dynamic routes.**
- *Wildcard resources* (`*` as subdomain, optionally under a parent such as
  `*.apps`): "one resource owns an entire subdomain level". The target receives the
  original `Host`, so a proxy downstream does the routing [pangolin wildcard
  resources]. The docs say this is **Cloud and Enterprise only**, and the code agrees:
  `createResource.ts` refuses a `*` subdomain unless `isLicensedOrSubscribed` holds
  [createResource.ts]. In the OSS build that function always returns `false`
  [isLicensedOrSubscribed.ts (OSS)]. In the enterprise build it returns
  `license.isUnlocked()` [isLicensedOrSubscribed.ts (private)], so any valid licence
  key unlocks it. A closed issue confirms CE can never create one [pangolin#3866].
- *Enterprise licence:* free for personal use and for organisations under $100k gross
  annual revenue. You still have to get a key; there is one key per host, and you
  switch to the `fosrl/pangolin:ee-<version>` image [pangolin EE], [pangolin EE FAQ].
  No user or site limit is published for the personal key [pangolin EE limits]. The
  EE code is under the Fossorial Commercial License, not AGPL.
- *Per-resource automation in CE:* (a) the **Integration API** (API keys scoped to an
  org, enabled on self-hosted, Swagger at `api.<domain>/v1/docs`) covers resources
  and targets [pangolin integration API]. (b) **Blueprints:** resources as YAML or as
  container labels such as `pangolin.public-resources.<key>.full-domain=…` and
  `…targets[0].port=80`. The site discovers them through the Docker socket and
  applies labels continuously [pangolin blueprints]. The docs don't say whether
  removing the container deletes the resource; check before relying on labels for
  teardown. If it doesn't, an explicit API delete on PR close is the safe path.

**Fit with home services.** This is what Pangolin is for. Every service is a
resource with its own optional SSO/PIN/rules, so previews sit beside Jellyfin and HA
as resources. Each site agent can only reach what its own Docker network or host can
reach, so a dedicated preview site gives network isolation. Pangolin can also sit
behind Cloudflare's proxy, but only in Full (Strict) mode [pangolin cloudflare proxy].
That would put Cloudflare's certificate at the edge and make Cloudflare part of the
X-Forwarded-For chain, so keep the records grey-cloud.

**Cost and upkeep.** The minimum VPS is 1 vCPU / 2 GB / 8 GB SSD; 2 vCPU / 2 GB /
20 GB is recommended. Open TCP 80/443 plus the WireGuard UDP port(s). Data throughput
is the main cost driver, and most plans include 1–2 TB/month [pangolin choosing a
VPS]. Jellyfin streamed off-site goes through the VPS, so bandwidth matters more than
CPU. As an example, Hetzner's EU cost-optimised plans list 20 TB included [hetzner
cloud]. Prices didn't render, so check them. Moving parts on the VPS: Pangolin,
Gerbil, Traefik (+ Badger plugin, optionally CrowdSec). At home: one site container.
Releases come about every two weeks.

### frp + Traefik or Caddy (frp v0.71.1, Traefik v3.7.15, Caddy v2.11.7)

**Certificates.** Traefik has the Cloudflare DNS-01 provider built in. In Caddy, the
DNS challenge needs a `caddy-dns` provider module compiled in, i.e. a custom build;
LE wildcards need the DNS challenge [caddy automatic https]. Either can hold
`*.preview.<domain>`. Caddy's alternative, on-demand TLS (one certificate per host at
first handshake, gated by an `ask` endpoint), works without DNS-01. But it counts
against LE's 50 certificates per registered domain per 7 days [LE rate limits], so a
wildcard is still better.

**Dynamic routes.** frps vhost routing supports wildcard domains: on an exact-host
miss it tries `*.preview.example.com`, then shorter wildcards, then `*`
[frp router.go]. So one frpc proxy with `customDomains = ["*.preview.<domain>"]`, or
a VPS Traefik wildcard router to one frp TCP tunnel, sends every preview to a proxy
at home. There, Traefik's Docker provider (or caddy-docker-proxy) routes by labels.
No per-PR step. `frpc reload` hot-reloads, and the frpc `webServer` exposes an HTTP
API [frp README].

**Fit and upkeep.** You hand-build what Pangolin packages: Traefik routers and
middlewares for each home service, an auth layer (e.g. forward-auth) for HA and the
previews, and frp token/TLS hardening. It uses fewer resources (frps is one Go binary)
but means more config files to own, and nothing gives a UI or SSO.

**Client IP.** frp TCP tunnels hide the client unless you use PROXY protocol
(`transport.proxyProtocolVersion = "v1"|"v2"`) or the VPS proxy adds
`X-Forwarded-For` before the tunnel [frp README].

### Cloudflare Tunnel (cloudflared 2026.10.1)

**Certificates.** Universal SSL (free) covers the apex and **first-level** subdomains
only. `a.b.example.com` "will not serve a valid certificate". Deeper names need
Advanced Certificate Manager (a paid add-on on every plan) with Total TLS or an
explicit `*.preview.<domain>` certificate, or an uploaded custom certificate
[CF universal SSL limitations], [CF ACM]. ACM is $10/month per zone [CF ACM blog].
**So on the free plan, Cloudflare Tunnel does force a flat scheme like
`pr-17-preview.<domain>`.** Either way the browser sees a certificate Cloudflare
manages at its edge, not one you got from Let's Encrypt.

**Dynamic routes.** Proxied wildcard DNS records are allowed on all plans, including
Free, and can sit under a label (`*.preview`) [CF wildcard DNS]. cloudflared ingress
rules accept a leading wildcard (`*.example.com`), but not one in the middle
(`test.*.example.com`) [CF tunnel config file]. So one wildcard record plus one
wildcard ingress rule to a home proxy that routes by `Host` needs no per-PR step.
Otherwise you add one CNAME per hostname [CF tunnel DNS].

**Fit with home services.** It doesn't fit the VPS plan; it would be a second
ingress. Cloudflare's CDN terms say that, unless you are an Enterprise customer, you
must use its paid services (Stream etc.) to serve video and large files, and it may
limit sites that serve a disproportionate share of such content [CF service terms].
That makes Jellyfin through the proxy a risk. (The terms page doesn't mention Tunnel
specifically.)

**Cost.** Free; one `cloudflared` container.

**Limits that touch Banki.** Request bodies are capped at 100 MB on Free/Pro
(413 above that) [CF limits]. Proxy read timeout is 125 s (524), not configurable
below Enterprise [CF connection limits]. Cloudflare sets `CF-Connecting-IP` and
appends to `X-Forwarded-For` [CF HTTP headers].

### What could break Banki behind each

| Concern | Pangolin | frp + Traefik/Caddy | Cloudflare Tunnel |
| --- | --- | --- | --- |
| SSE (grading streams) | Traefik ignores `flushInterval` for responses it recognises as streaming [Traefik service]. Newt relays raw TCP. One closed issue reports long LLM SSE streams dropping through Pangolin, never reproduced by maintainers [pangolin#3202]. Send heartbeats. | Caddy flushes `text/event-stream` immediately [Caddy reverse_proxy]. Traefik as left. frp TCP is transparent. | Streams pass, but a stream silent for more than 125 s risks a 524 [CF connection limits]. Send heartbeats. |
| `X-Forwarded-For` | VPS Traefik strips untrusted incoming `X-Forwarded-*` [Traefik forwarded_header.go] (no `trustedIPs` in the default install) and adds the client IP. `web` sees the site container's IP. | VPS proxy sets it, or PROXY protocol does. `web` sees frpc or the home proxy. | Cloudflare sets it. `web` sees cloudflared. |
| Upload size | No body limit in Traefik by default. Pangolin's install raises `websecure` `readTimeout` to 30m [install traefik_config.yml] (Traefik's default is 60 s for the whole request, body included [Traefik entrypoints]). CrowdSec AppSec, if enabled, has a 10 MB body setting that has bitten uploads [pangolin#1106]. | None by default (Traefik 60 s `readTimeout` unless raised). | 100 MB on Free [CF limits]. |

**X-Forwarded-For with Banki's Caddy.** `apps/web/Caddyfile` uses `trusted_proxies
static {$BANKI_TRUSTED_PROXIES}` with `trusted_proxies_strict`, which reads the header
right to left and skips trusted hops. So every hop between the tunnel endpoint and
`web` must be listed:

- Pangolin target → `web` directly (CE per-PR resources): VPS Traefik sends
  `X-Forwarded-For: <client>`, and `web`'s TCP peer is the site container. Set
  `BANKI_TRUSTED_PROXIES` to that container's address. Give it a fixed IP on the
  preview network; the subnet works only if nothing else on it is a client.
- Pangolin wildcard → home proxy → `web` (EE): the home proxy must trust the site
  container (Traefik `forwardedHeaders.trustedIPs` / Caddy `trusted_proxies`).
  Otherwise it drops the client IP and puts in the site container's. Banki must then
  trust the home proxy and the site container.
- Turning on Cloudflare's orange cloud adds Cloudflare to the chain. The VPS Traefik
  would need Cloudflare's ranges in `trustedIPs`. Another reason to keep DNS-only.

## Facts later tickets depend on

- Hostname scheme: `pr-N.preview.<domain>` works with Pangolin (one
  `*.preview.<domain>` LE certificate). Only Cloudflare's proxy/Tunnel would force
  `pr-N-preview.<domain>`.
- Cloudflare token for DNS-01: `Zone:Read` + `DNS:Edit` on the zone. DNS records:
  a grey-cloud `*.preview` A/AAAA record pointing at the VPS.
- Wildcard Pangolin resources need the EE image and a (free personal) licence key.
  Without one, preview automation must create and delete a resource per PR (Integration
  API or Blueprint labels).
- Each preview needs `BANKI_ORIGIN=https://pr-N.preview.<domain>` and a
  `BANKI_TRUSTED_PROXIES` listing exactly the in-home hops (site container, plus the
  home proxy if there is one).
- SSE must send a heartbeat comfortably under 60 s to be safe through any of these
  proxies.

## Sources

- [pangolin releases] https://github.com/fosrl/pangolin/releases
- [newt README] https://github.com/fosrl/newt
- [install traefik_config.yml] https://github.com/fosrl/pangolin/blob/main/install/config/traefik/traefik_config.yml
- [pangolin wildcard domains] https://docs.pangolin.net/self-host/advanced/wild-card-domains
- [pangolin wildcard resources] https://docs.pangolin.net/manage/resources/public/wildcard-resources
- [certResolver.ts] https://github.com/fosrl/pangolin/blob/main/server/lib/traefik/certResolver.ts
- [createResource.ts] https://github.com/fosrl/pangolin/blob/main/server/routers/resource/createResource.ts (lines 428–442)
- [isLicensedOrSubscribed.ts (OSS)] https://github.com/fosrl/pangolin/blob/main/server/lib/isLicencedOrSubscribed.ts
- [isLicensedOrSubscribed.ts (private)] https://github.com/fosrl/pangolin/blob/main/server/private/lib/isLicencedOrSubscribed.ts
- [tierMatrix.ts] https://github.com/fosrl/pangolin/blob/main/server/lib/billing/tierMatrix.ts
- [pangolin#3866] https://github.com/fosrl/pangolin/issues/3866
- [pangolin#3875] https://github.com/fosrl/pangolin/issues/3875
- [pangolin#3202] https://github.com/fosrl/pangolin/issues/3202
- [pangolin#1106] https://github.com/fosrl/pangolin/issues/1106
- [pangolin EE] https://docs.pangolin.net/self-host/enterprise-edition
- [pangolin EE FAQ] https://docs.pangolin.net/self-host/enterprise-edition/faq
- [pangolin EE limits] https://docs.pangolin.net/self-host/enterprise-edition/limits
- [pangolin integration API] https://docs.pangolin.net/manage/integration-api
- [pangolin blueprints] https://docs.pangolin.net/manage/blueprints
- [pangolin cloudflare proxy] https://docs.pangolin.net/self-host/advanced/cloudflare-proxy
- [pangolin choosing a VPS] https://docs.pangolin.net/self-host/choosing-a-vps
- [hetzner cloud] https://www.hetzner.com/cloud/cost-optimized/
- [frp README] https://github.com/fatedier/frp
- [frp router.go] https://github.com/fatedier/frp/blob/master/pkg/util/vhost/router.go
- [caddy automatic https] https://caddyserver.com/docs/automatic-https
- [Caddy reverse_proxy] https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- [LE rate limits] https://letsencrypt.org/docs/rate-limits/
- [Traefik service] https://doc.traefik.io/traefik/reference/routing-configuration/http/load-balancing/service/
- [Traefik entrypoints] https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/
- [Traefik forwarded_header.go] https://github.com/traefik/traefik/blob/master/pkg/middlewares/forwardedheaders/forwarded_header.go
- [CF universal SSL limitations] https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/
- [CF ACM] https://developers.cloudflare.com/ssl/edge-certificates/advanced-certificate-manager/
- [CF ACM blog] https://blog.cloudflare.com/advanced-certificate-manager/
- [CF wildcard DNS] https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/
- [CF tunnel config file] https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/
- [CF tunnel DNS] https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/
- [CF service terms] https://www.cloudflare.com/service-specific-terms-application-services/
- [CF limits] https://developers.cloudflare.com/workers/platform/limits/ (request body size by plan)
- [CF connection limits] https://developers.cloudflare.com/fundamentals/reference/connection-limits/
- [CF HTTP headers] https://developers.cloudflare.com/fundamentals/reference/http-headers/
