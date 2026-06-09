#!/usr/bin/env node
'use strict';

/*
 * Munich Amt Termin Notifier
 * --------------------------
 * Queries the City of Munich citizen appointment API ("Bürgeransicht" / ZMS)
 * for available days and notifies when slots open up.
 *
 * The old netappoint/iframe booking system was retired — Munich migrated to
 * the Berlin ZMS ("Zeitmanagementsystem"). The Vue front-end at
 *   https://stadt.muenchen.de/buergerservice/terminvereinbarung.html
 * talks to this JSON API:
 *   GET {API_BASE}/available-days/?officeId=&serviceId=&serviceCount=&startDate=&endDate=
 *     -> { "availableDays": ["YYYY-MM-DD", ...] }            (slots free)
 *     -> 404 { "errors": [{ "errorCode": "noAppointmentForThisScope" }] }  (none free)
 *
 * Configure via environment variables (all optional, sensible defaults below).
 */

const fs = require('fs');

const API_BASE =
  process.env.API_BASE || 'https://www48.muenchen.de/buergeransicht/api/citizen';

// Defaults: "Umschreibung eines ausländischen Führerscheins" at the Führerscheinstelle.
// Find other IDs in any booking link: terminvereinbarung.html#/services/<SERVICE_ID>/locations/<OFFICE_ID>
const OFFICE_ID = process.env.OFFICE_ID || '10308174';
const SERVICE_ID = process.env.SERVICE_ID || '1071896';
const SERVICE_COUNT = process.env.SERVICE_COUNT || '1';
const DAYS_AHEAD = parseInt(process.env.DAYS_AHEAD || '90', 10);
// Optional: only alert on slots on/before this date (YYYY-MM-DD). Empty = any date.
const NOT_AFTER = process.env.NOT_AFTER || '';
// When true (default), exit non-zero on availability so the GitHub Actions run
// fails and emails you. Set to "false" to always exit 0.
const FAIL_WHEN_AVAILABLE = process.env.FAIL_WHEN_AVAILABLE !== 'false';

const BOOKING_URL = `https://stadt.muenchen.de/buergerservice/terminvereinbarung.html#/services/${SERVICE_ID}/locations/${OFFICE_ID}`;

const ymd = (d) => d.toISOString().slice(0, 10);

async function getAvailableDays() {
  const params = new URLSearchParams({
    officeId: OFFICE_ID,
    serviceId: SERVICE_ID,
    serviceCount: SERVICE_COUNT,
    startDate: ymd(new Date()),
    endDate: ymd(new Date(Date.now() + DAYS_AHEAD * 86400000)),
  });
  const url = `${API_BASE}/available-days/?${params}`;

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));

  if (Array.isArray(body.availableDays)) return body.availableDays;

  // 404 + noAppointmentForThisScope is the API's normal "nothing free" answer.
  const noSlots =
    res.status === 404 ||
    (Array.isArray(body.errors) &&
      body.errors.some((e) => e.errorCode === 'noAppointmentForThisScope'));
  if (noSlots) return [];

  throw new Error(`Unexpected API response (HTTP ${res.status}): ${JSON.stringify(body)}`);
}

function appendFile(envVar, text) {
  const file = process.env[envVar];
  if (file) fs.appendFileSync(file, text);
}
const setOutput = (k, v) => appendFile('GITHUB_OUTPUT', `${k}=${v}\n`);
const writeSummary = (md) => appendFile('GITHUB_STEP_SUMMARY', md + '\n');

(async () => {
  console.log(
    `🔎 Checking Munich appointments — service ${SERVICE_ID} @ office ${OFFICE_ID} ` +
      `(next ${DAYS_AHEAD} days${NOT_AFTER ? `, on/before ${NOT_AFTER}` : ''})…`
  );

  let days;
  try {
    days = await getAvailableDays();
  } catch (e) {
    console.error('❌ Check failed:', e.message);
    setOutput('available', 'false');
    writeSummary(`### ❌ Appointment check failed\n\n\`\`\`\n${e.message}\n\`\`\``);
    process.exit(2); // hard error, distinct from "no slots"
  }

  const relevant = NOT_AFTER ? days.filter((d) => d <= NOT_AFTER) : days;

  if (relevant.length === 0) {
    console.log('😴 No appointments available right now.');
    setOutput('available', 'false');
    writeSummary(
      `### 😴 No appointments available\nService \`${SERVICE_ID}\` @ office \`${OFFICE_ID}\` — checked ${new Date().toISOString()}.`
    );
    return; // exit 0
  }

  const list = relevant.join(', ');
  console.log('🚨 AVAILABLE:', list);
  console.log('👉', BOOKING_URL);

  setOutput('available', 'true');
  setOutput('dates', list);
  writeSummary(
    `### 🚨 Appointments available!\n\n- **Date(s):** ${list}\n- **[Book now →](${BOOKING_URL})**`
  );

  if (FAIL_WHEN_AVAILABLE) {
    // Non-zero exit -> the scheduled run is marked failed and GitHub emails you.
    // (A "failed" run here is good news: a slot is free.)
    process.exit(1);
  }
})();
