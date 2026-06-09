/*
 * Typed catalog of Munich services and offices.
 *
 * The raw data lives in catalog.generated.ts (scraped from the API via
 * `bun run generate:catalog`). This module derives the literal-union ID types
 * and provides validation helpers used to keep every request properly typed.
 */

import { OFFICES, SERVICES, SERVICE_OFFICES } from "./catalog.generated";

export { OFFICES, SERVICES, SERVICE_OFFICES };

export type ServiceEntry = (typeof SERVICES)[number];
export type OfficeEntry = (typeof OFFICES)[number];

/** Every service ID known to the catalog. */
export type ServiceId = ServiceEntry["id"];
/** Every office ID known to the catalog. */
export type OfficeId = OfficeEntry["id"];

/** Services that have at least one public booking office. */
export type WatchableServiceId = keyof typeof SERVICE_OFFICES;
/** The office IDs that are valid for a given watchable service. */
export type OfficeForService<S extends WatchableServiceId> = (typeof SERVICE_OFFICES)[S][number];

const SERVICE_IDS: ReadonlySet<number> = new Set(SERVICES.map((s) => s.id));
const OFFICE_IDS: ReadonlySet<number> = new Set(OFFICES.map((o) => o.id));

export const isServiceId = (n: number): n is ServiceId => SERVICE_IDS.has(n);
export const isOfficeId = (n: number): n is OfficeId => OFFICE_IDS.has(n);

/** Narrow an arbitrary number to a ServiceId, throwing if it is unknown. */
export function toServiceId(n: number): ServiceId {
  if (!isServiceId(n)) throw new Error(`Unknown serviceId ${n} (not in catalog)`);
  return n;
}

/** Narrow an arbitrary number to an OfficeId, throwing if it is unknown. */
export function toOfficeId(n: number): OfficeId {
  if (!isOfficeId(n)) throw new Error(`Unknown officeId ${n} (not in catalog)`);
  return n;
}

export const serviceName = (id: ServiceId): string =>
  SERVICES.find((s) => s.id === id)?.name ?? String(id);
export const officeName = (id: OfficeId): string =>
  OFFICES.find((o) => o.id === id)?.name ?? String(id);

/** Office IDs that publicly offer the given service (empty if none). */
export function officesForService(id: ServiceId): readonly OfficeId[] {
  return (SERVICE_OFFICES as Record<number, readonly OfficeId[]>)[id] ?? [];
}
