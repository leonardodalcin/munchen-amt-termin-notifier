/*
 * Checks one Munich service for available appointment days and notifies when a
 * slot opens up. The CI workflow runs this once per watched service (a matrix
 * over watchlist.ts), passing parameters via environment variables.
 *
 * Required:  SERVICE_ID, OFFICE_ID   (must exist in the catalog)
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
import { MunichTerminClient } from "../libs/client";
import { serviceName, toOfficeId, toServiceId } from "../libs/catalog";

const RAW_SERVICE_ID = process.env.SERVICE_ID;
const RAW_OFFICE_ID = process.env.OFFICE_ID;
const SERVICE_COUNT = process.env.SERVICE_COUNT || "1";
const DAYS_AHEAD = parseInt(process.env.DAYS_AHEAD || "90", 10);
const NOT_AFTER = process.env.NOT_AFTER || "";
const FAIL_WHEN_AVAILABLE = process.env.FAIL_WHEN_AVAILABLE !== "false";
const LABEL = process.env.SERVICE_NAME || `service ${RAW_SERVICE_ID}`;

if (!RAW_SERVICE_ID || !RAW_OFFICE_ID) {
  console.error("SERVICE_ID and OFFICE_ID are required.");
  process.exit(2);
}

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

function appendEnvFile(envVar: string, text: string): void {
  const file = process.env[envVar];
  if (file) appendFileSync(file, text);
}
const setOutput = (key: string, value: string): void =>
  appendEnvFile("GITHUB_OUTPUT", `${key}=${value}\n`);
const writeSummary = (md: string): void => appendEnvFile("GITHUB_STEP_SUMMARY", md + "\n");

async function main(): Promise<void> {
  // Validate the IDs against the catalog — this is what keeps the request typed.
  const serviceId = toServiceId(Number(RAW_SERVICE_ID));
  const officeId = toOfficeId(Number(RAW_OFFICE_ID));
  const name = process.env.SERVICE_NAME || serviceName(serviceId);
  const bookingUrl = `https://stadt.muenchen.de/buergerservice/terminvereinbarung.html#/services/${serviceId}/locations/${officeId}`;

  console.log(
    `🔎 ${name} — service ${serviceId} @ office ${officeId} ` +
      `(next ${DAYS_AHEAD} days${NOT_AFTER ? `, on/before ${NOT_AFTER}` : ""})…`,
  );

  const client = new MunichTerminClient();
  const result = await client.availableDaysAuto({
    officeId,
    serviceId,
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
    writeSummary(`### 😴 ${name} — no appointments available`);
    return;
  }

  const list = relevant.join(", ");
  console.log("🚨 AVAILABLE:", list);
  console.log("👉", bookingUrl);
  setOutput("available", "true");
  setOutput("dates", list);
  writeSummary(
    `### 🚨 ${name} — appointments available!\n\n- **Date(s):** ${list}\n- **[Book now →](${bookingUrl})**`,
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
  writeSummary(`### ❌ ${LABEL} — check failed\n\n\`\`\`\n${msg}\n\`\`\``);
  process.exit(2);
});
