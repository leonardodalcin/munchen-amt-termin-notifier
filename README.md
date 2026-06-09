# munchen-amt-termin-notifier

[![Verify Munich appointment availability](https://github.com/leonardodalcin/munchen-amt-termin-notifier/actions/workflows/verify-appointment-available.yml/badge.svg?branch=main)](https://github.com/leonardodalcin/munchen-amt-termin-notifier/actions/workflows/verify-appointment-available.yml)

Polls the City of Munich appointment system and notifies you when a slot opens up.

Munich retired the old iframe/netappoint booking tool and moved to the Berlin
**ZMS ("Bürgeransicht")** system. This project queries its JSON API directly —
no browser, no scraping, no dependencies — and runs on a schedule via GitHub
Actions.

## How it works

A scheduled GitHub Action runs [`check-appointments.js`](./check-appointments.js)
every 10 minutes. The script calls:

```
GET https://www48.muenchen.de/buergeransicht/api/citizen/available-days/
      ?officeId=<OFFICE_ID>&serviceId=<SERVICE_ID>&serviceCount=1
      &startDate=<today>&endDate=<today + DAYS_AHEAD>
```

- Slots free → `{ "availableDays": ["YYYY-MM-DD", ...] }`
- None free → `404 { "errors": [{ "errorCode": "noAppointmentForThisScope" }] }`

When a slot is found, the script prints the dates + booking link, writes a job
summary, optionally sends a Telegram message, and **exits non-zero** so the
Actions run is marked *failed* — which makes **GitHub email you**. A red run
here is good news: an appointment is available.

## Configuration

Defaults watch **"Umschreibung eines ausländischen Führerscheins"** at the
Führerscheinstelle. Override via repository **Variables**
(`Settings → Secrets and variables → Actions → Variables`):

| Variable        | Default      | Meaning                                                        |
| --------------- | ------------ | -------------------------------------------------------------- |
| `SERVICE_ID`    | `1071896`    | The service to watch.                                          |
| `OFFICE_ID`     | `10308174`   | The office/location.                                           |
| `SERVICE_COUNT` | `1`          | Number of appointments needed.                                 |
| `DAYS_AHEAD`    | `90`         | How far into the future to look.                               |
| `NOT_AFTER`     | *(empty)*    | Only alert on slots on/before this date (`YYYY-MM-DD`).        |

### Finding the IDs for a different service

Open the service's info page on `stadt.muenchen.de`, click **Termin
vereinbaren**, and read them off the booking URL:

```
terminvereinbarung.html#/services/<SERVICE_ID>/locations/<OFFICE_ID>
```

### Optional: Telegram push notifications

Add these repository **Secrets** to also get a Telegram message:

- `TELEGRAM_BOT_TOKEN` — from [@BotFather](https://t.me/BotFather)
- `TELEGRAM_CHAT_ID` — your chat/user id

## Run locally

```bash
npm start                      # uses the defaults
SERVICE_ID=1071944 npm start   # e.g. "Umschreibung EU/EWR-Führerschein"
```

Requires Node 18+ (uses the built-in `fetch`). Exit codes: `0` none free,
`1` slot(s) found, `2` check error.
