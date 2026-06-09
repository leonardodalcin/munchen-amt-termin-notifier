# munchen-amt-termin-notifier

[![Verify Munich appointment availability](https://github.com/leonardodalcin/munchen-amt-termin-notifier/actions/workflows/verify-appointment-available.yml/badge.svg?branch=main)](https://github.com/leonardodalcin/munchen-amt-termin-notifier/actions/workflows/verify-appointment-available.yml)

Polls the City of Munich appointment system across **multiple services** and
notifies you when a slot opens up — Führerschein, Einbürgerung, immigration
(Aufenthaltstitel), and anything else in the citizen booking system.

Munich uses the Berlin **ZMS ("Bürgeransicht")** system. This project queries its
JSON API directly with a small, strictly-typed [Bun](https://bun.sh) client — no
browser, no scraping. The scheduled GitHub Action checks the **immigration
service** (_Notfall-Hilfe Aufenthaltstitel_) every 5 minutes; use the manual
**Run workflow** dropdown to check Führerschein, Einbürgerung, or all of
[`watchlist.ts`](./libs/watchlist.ts).

## Layout

`libs/` holds importable modules, `apps/` holds runnable entry points:

| File                        | Purpose                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| `libs/client.ts`            | `MunichTerminClient` — availability requests + per-call logging   |
| `libs/middleware.ts`        | Injectable request middleware; the Altcha verification lives here |
| `libs/catalog.generated.ts` | Full scraped list of services & offices (do not edit by hand)     |
| `libs/catalog.ts`           | Derived `ServiceId`/`OfficeId` types + validation helpers         |
| `libs/watchlist.ts`         | The services to poll — **type-checked against the catalog**       |
| `libs/*.test.ts`            | `bun test` unit tests (catalog, middleware, client)               |
| `apps/check.ts`             | Per-service checker the CI runs; notifies on availability         |
| `apps/find-service.ts`      | Search the catalog for service/office IDs                         |
| `apps/matrix.ts`            | Emits the watch-list as JSON for the CI matrix                    |
| `apps/generate-catalog.ts`  | Re-scrapes `libs/catalog.generated.ts` from the live API          |

## Adding a service to the watch-list

1. **Find the IDs** by name:

   ```bash
   bun run find aufenthalt        # or: führerschein, einbürgerung, …
   ```

   It prints each matching service's `serviceId`, the offering office's
   `officeId`, and a booking link.

2. **Add a typed entry** to [`watchlist.ts`](./libs/watchlist.ts):

   ```ts
   export const WATCHLIST = [
     { name: "Führerschein-Umschreibung (ausländisch)", serviceId: 1071896, officeId: 10308174 },
     { name: "Einbürgerung", serviceId: 1071907, officeId: 10471 },
     // add yours here:
     { name: "My service", serviceId: 1234567, officeId: 7654321 },
   ] as const satisfies readonly WatchEntry[];
   ```

   This is **fully type-checked**: an unknown `serviceId` is a compile error, and
   `officeId` is constrained to the offices that actually offer that service — so
   a wrong pairing won't compile. Optional per-entry keys: `serviceCount`
   (default 1), `daysAhead` (default 90), `notAfter` (`YYYY-MM-DD`), and
   `captcha: true` for captcha-gated services.

If the service is brand new and not in the catalog yet, refresh it:

```bash
bun run generate:catalog       # re-scrapes catalog.generated.ts from the live API
```

## How notification works

When a slot is found, the job prints the dates + booking link, writes a job
summary, and **exits non-zero** so the run is marked _failed_ — which makes
**GitHub email you**. A red run here is good news. `fail-fast: false` means one
service finding a slot never cancels the others.

## Running manually

The workflow has a **Run workflow** button (`workflow_dispatch`) with a dropdown
to pick `all` or a single service. The dropdown options live in the workflow
(GitHub requires static choices) — keep them in sync with `libs/watchlist.ts`.

## Captcha-gated services (immigration)

High-demand services (e.g. _Notfall-Hilfe Aufenthaltstitel_) are protected by an
**Altcha** proof-of-work captcha. It is handled by an **injected middleware**
([`libs/middleware.ts`](./libs/middleware.ts)) that activates only when a service
answers `captchaMissing`: it solves the proof-of-work via the public
`captcha-challenge` / `captcha-verify` endpoints, exchanges it for a token, and
retries — **so it works from anywhere, no proxy or German egress required.**
Keeping it as middleware keeps the captcha concern out of the core request path
and makes it easy to swap or disable (`new MunichTerminClient({ middlewares: [] })`).
Services marked `"captcha": true` in the watch-list are just documentation;
detection is automatic.

## Develop

```bash
bun install
bun test                                            # bun's built-in test runner
bun run typecheck                                   # tsc --noEmit (TypeScript 6)
bun run format                                      # oxfmt --write .
SERVICE_ID=1071896 OFFICE_ID=10308174 bun start     # check one service
DEBUG=1 SERVICE_ID=10339028 OFFICE_ID=10461 bun start   # verbose run (immigration)
```

Every API call is logged (method, URL, status, timing, error body; the captcha
token is redacted). The logger is injectable — `new MunichTerminClient({ logger: () => {} })`
silences it.

- **CI** (`.github/workflows/ci.yml`) runs oxfmt + typecheck + `bun test` on every
  non-main branch / PR.
- **Claude Code hooks** (`.claude/`) auto-run oxfmt + typecheck on each edit.

Exit codes: `0` none free, `1` slot(s) found, `2` check error. Requires
[Bun](https://bun.sh) (≥1.0).

## License

[CC BY 4.0](./LICENSE) — use, adapt, and share freely, **as long as you credit
Leonardo Dalcin**.
