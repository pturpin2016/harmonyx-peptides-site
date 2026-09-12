# HarmonyX daylight rebuild

Staging branch for the brighter catalog. **Do not merge to `main` until Cloudflare Pages is switched** — `main` still auto-deploys the current static site to harmony-x.com.

## What this rebuild is

- Ivory / espresso / bronze catalog
- HarmonyX lockup, doctor-led sourcing, Integrity · Trust · Transparency
- Catalog grouping, most-popular lead vials, COA page
- Live inventory from `harmonyx-proxy.pturpin2016.workers.dev`
- Orders POST to `/api/order` with Cloudflare Turnstile when the host is harmony-x.com

## Cutover (when you are ready)

1. Keep this branch as a Cloudflare Pages **preview** first.
2. Confirm a test request tickets Paul and Thabby.
3. Point the production Pages project at this build, or merge to `main` only after the build command is set.

Until then, harmony-x.com stays on the existing static site.
