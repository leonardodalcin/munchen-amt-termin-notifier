# munchen-amt-termin-notifier

[![Verify Munich appointment availability](https://github.com/leonardodalcin/munchen-amt-termin-notifier/actions/workflows/verify-appointment-available.yml/badge.svg?branch=main)](https://github.com/leonardodalcin/munchen-amt-termin-notifier/actions/workflows/verify-appointment-available.yml)

Polls the City of Munich appointment system across **multiple services** and
notifies you when a slot opens up — Führerschein, Einbürgerung, immigration
(Aufenthaltstitel), and anything else in the citizen booking system.

Munich uses the Berlin **ZMS ("Bürgeransicht")** system. This project queries
its JSON API directly — a small typed [Bun](https://bun.sh) client, no browser,
no scraping. A scheduled GitHub Action checks every service in
[`services.json`](./services.json) every 10 minutes (one matrix job each).

## Layout

| File              | Purpose                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `client.ts`       | `MunichTerminClient` — services/offices discovery, availability, captcha |
| `check.ts`        | CLI the CI runs per service; notifies on availability                   |
| `find-service.ts` | CLI to look up service/office IDs by name                               |
| `services.json`   | The watch-list (drives the CI matrix)                                   |

## Finding service & office IDs

```bash
bun run find aufenthalt      # or: bun find-service.ts <term>
```

Prints matching services with their `serviceId`, the offering office(s)
`officeId`, and a booking link. Add the ones you want to `services.json`:

```json
[
  { "name": "Führerschein-Umschreibung (ausländisch)", "serviceId": 1071896, "officeId": 10308174 },
  { "name": "Einbürgerung", "serviceId": 1071907, "officeId": 10471 },
  { "name": "Notfall-Hilfe Aufenthaltstitel", "serviceId": 10339028, "officeId": 10461, "captcha": true }
]
```

Optional per-entry keys: `serviceCount` (default 1), `daysAhead` (default 90),
`notAfter` (`YYYY-MM-DD`, only alert on slots on/before that date).

## How notification works

When a slot is found, the job prints the dates + booking link, writes a job
summary, and **exits non-zero** so the run is marked *failed* — which makes
**GitHub email you**. A red run here is good news. `fail-fast: false` means one
service finding a slot never cancels the others.

## Captcha-gated services (immigration) ⚠️

High-demand services (e.g. *Notfall-Hilfe Aufenthaltstitel*) are protected by an
**Altcha** proof-of-work captcha. The client solves the proof-of-work
automatically and runs the challenge → solve → verify flow — **but** the captcha
is verified against `captcha-prod.muenchen.de`, which is **only resolvable from
inside Germany**. GitHub's runners are outside Germany, so these checks need to
exit through a **German HTTP(S) proxy**:

1. Stand up a cheap German proxy and add a repository secret **`MUC_PROXY_URL`** —
   step-by-step guide: **[docs/german-proxy.md](./docs/german-proxy.md)**.
2. The workflow passes it to the client *only* for services marked
   `"captcha": true`, which routes their requests through Germany.

Non-captcha services (Führerschein, Einbürgerung, …) run direct — no proxy
needed, and they keep working even if the proxy is down.

## Run / develop locally

```bash
bun install
bun run typecheck                                   # tsc --noEmit (TypeScript 6)
SERVICE_ID=1071896 OFFICE_ID=10308174 bun start     # check one service
MUC_PROXY_URL=http://de-proxy:8080 \
  SERVICE_ID=10339028 OFFICE_ID=10461 bun start     # captcha service via DE proxy
```

Exit codes: `0` none free, `1` slot(s) found, `2` check error. Requires
[Bun](https://bun.sh) (≥1.0); type-checked with TypeScript ^6.
