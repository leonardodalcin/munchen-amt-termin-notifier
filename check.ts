/*
 * Checks one Munich service for available appointment days and notifies when a
 * slot opens up. The CI workflow runs this once per watched service (a matrix
 * over services.json), passing parameters via environment variables.
 *
 * Required:  SERVICE_ID, OFFICE_ID
 * Optional:  SERVICE_NAME, SERVICE_COUNT(=1), DAYS_AHEAD(=90),
 *            NOT_AFTER(YYYY-MM-DD), MUC_PROXY_URL, FAIL_WHEN_AVAILABLE(=true)
 *
 * Captcha-gated services (e.g. immigration / Aufenthaltstitel) are handled
 * automatically — but the captcha host is only reachable from Germany, so set
 * MUC_PROXY_URL to a German HTTP(S) proxy when running outside Germany.
 *
 * Exit codes: 0 = none free, 1 = slot(s) found, 2 = check error.
 */

import { appendFileSync } from "node:fs";
import { MunichTerminClient } from "./client";

const SERVICE_ID = process.env.SERVICE_ID;
const OFFICE_ID = process.env.OFFICE_ID;
const SERVICE_NAME = process.env.SERVICE_NAME || `service ${SERVICE_ID}`;
const SERVICE_COUNT = process.env.SERVICE_COUNT || "1";
const DAYS_AHEAD = parseInt(process.env.DAYS_AHEAD || "90", 10);
const NOT_AFTER = process.env.NOT_AFTER || "";
const FAIL_WHEN_AVAILABLE = process.env.FAIL_WHEN_AVAILABLE !== "false";

if (!SERVICE_ID || !OFFICE_ID) {
  console.error("SERVICE_ID and OFFICE_ID are required.");
  process.exit(2);
}

const BOOKING_URL = `https://stadt.muenchen.de/buergerservice/terminvereinbarung.html#/services/${SERVICE_ID}/locations/${OFFICE_ID}`;
const ymd = (d: Date): string => d.toISOString().slice(0, 10);

function appendEnvFile(envVar: string, text: string): void {
  const file = process.env[envVar];
  if (file) appendFileSync(file, text);
}
const setOutput = (key: string, value: string): void => appendEnvFile("GITHUB_OUTPUT", `${key}=${value}\n`);
const writeSummary = (md: string): void => appendEnvFile("GITHUB_STEP_SUMMARY", md + "\n");

async function main(): Promise<void> {
  console.log(
    `🔎 ${SERVICE_NAME} — service ${SERVICE_ID} @ office ${OFFICE_ID} ` +
      `(next ${DAYS_AHEAD} days${NOT_AFTER ? `, on/before ${NOT_AFTER}` : ""})…`
  );

  const client = new MunichTerminClient();
  const result = await client.availableDaysAuto({
    officeId: OFFICE_ID!,
    serviceId: SERVICE_ID!,
    serviceCount: SERVICE_COUNT,
    startDate: ymd(new Date()),
    endDate: ymd(new Date(Date.now() + DAYS_AHEAD * 86_400_000)),
  });

  if (result.days === null) {
    const detail = result.errorCodes?.join(", ") || JSON.stringify(result.errors);
    throw new Error(`Unexpected API response (HTTP ${result.status}): ${detail}`);
  }

  const relevant = NOT_AFTER ? result.days.filter((d) => d <= NOT_AFTER) : result.days;

  if (relevant.length === 0) {
    console.log("😴 No appointments available right now.");
    setOutput("available", "false");
    writeSummary(`### 😴 ${SERVICE_NAME} — no appointments available`);
    return;
  }

  const list = relevant.join(", ");
  console.log("🚨 AVAILABLE:", list);
  console.log("👉", BOOKING_URL);
  setOutput("available", "true");
  setOutput("dates", list);
  writeSummary(
    `### 🚨 ${SERVICE_NAME} — appointments available!\n\n- **Date(s):** ${list}\n- **[Book now →](${BOOKING_URL})**`
  );

  if (FAIL_WHEN_AVAILABLE) {
    // Non-zero exit -> the run is marked failed and GitHub emails you.
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("❌ Check failed:", msg);
  setOutput("available", "false");
  writeSummary(`### ❌ ${SERVICE_NAME} — check failed\n\n\`\`\`\n${msg}\n\`\`\``);
  process.exit(2);
});
