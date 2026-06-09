/*
 * Discover service + office IDs to watch — searches the local typed catalog.
 *
 *   bun run find aufenthalt        (or: bun find-service.ts <search term>)
 *
 * Prints every catalog service whose name matches <search term>, the office(s)
 * that offer it, and a ready-to-use booking link. Use the printed
 * serviceId/officeId in watchlist.ts. Refresh the catalog from the live API with
 * `bun run generate:catalog`.
 */

import { OFFICES, SERVICES, officesForService, type OfficeId } from "../libs/catalog";

function main(): void {
  const term = process.argv.slice(2).join(" ").trim();
  if (!term) {
    console.error("Usage: bun find-service.ts <search term>");
    process.exit(64);
  }

  const officeById = new Map<OfficeId, (typeof OFFICES)[number]>(OFFICES.map((o) => [o.id, o]));
  const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const matches = SERVICES.filter((s) => re.test(s.name));

  if (matches.length === 0) {
    console.log(`No services matched "${term}".`);
    return;
  }

  for (const svc of matches) {
    console.log(`\n• ${svc.name}  (serviceId ${svc.id})`);
    const offices = officesForService(svc.id);
    if (offices.length === 0) {
      console.log("   (no public booking office)");
      continue;
    }
    for (const officeId of offices) {
      const o = officeById.get(officeId);
      const addr = o ? `${o.street} ${o.houseNumber}`.trim() : "";
      console.log(`   officeId ${officeId} — ${o ? o.name : "?"}${addr ? ` (${addr})` : ""}`);
      console.log(
        `      https://stadt.muenchen.de/buergerservice/terminvereinbarung.html#/services/${svc.id}/locations/${officeId}`,
      );
    }
  }
}

main();
