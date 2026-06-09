/*
 * Discover service + office IDs to watch.
 *
 *   bun find-service.ts <search term>
 *
 * Prints every service whose name matches <search term> (case-insensitive),
 * along with the office(s) that offer it and a ready-to-use booking link.
 * Use the printed serviceId/officeId in services.json.
 *
 * Examples:
 *   bun find-service.ts aufenthalt
 *   bun find-service.ts führerschein
 *   bun find-service.ts einbürgerung
 */

import { MunichTerminClient, type Office } from "./client";

async function main(): Promise<void> {
  const term = process.argv.slice(2).join(" ").trim();
  if (!term) {
    console.error("Usage: bun find-service.ts <search term>");
    process.exit(64);
  }

  const client = new MunichTerminClient();
  const { services, offices, relations } = await client.getOfficesAndServices();

  const officeById = new Map<number, Office>(offices.map((o) => [o.id, o]));
  const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const matches = services.filter((s) => re.test(s.name));

  if (matches.length === 0) {
    console.log(`No services matched "${term}".`);
    return;
  }

  for (const svc of matches) {
    console.log(`\n• ${svc.name}  (serviceId ${svc.id})`);
    const offs = relations.filter((r) => r.serviceId === svc.id && r.public);
    if (offs.length === 0) {
      console.log("   (no public booking office)");
      continue;
    }
    for (const rel of offs) {
      const o = officeById.get(rel.officeId);
      const addr = o?.address ? `${o.address.street} ${o.address.house_number}` : "";
      console.log(`   officeId ${rel.officeId} — ${o ? o.name : "?"}${addr ? ` (${addr})` : ""}`);
      console.log(
        `      https://stadt.muenchen.de/buergerservice/terminvereinbarung.html#/services/${svc.id}/locations/${rel.officeId}`
      );
    }
  }
}

main().catch((e: unknown) => {
  console.error("Error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
