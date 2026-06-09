/*
 * The services to poll. Fully typed against the catalog: a wrong serviceId is a
 * compile error, and officeId is constrained to the offices that actually offer
 * that service. Refresh the catalog with `bun run generate:catalog`.
 */

import type { OfficeForService, WatchableServiceId } from "./catalog";

interface WatchEntryBase {
  /** Human-readable label shown in logs / notifications. */
  name: string;
  /** Number of appointments needed (default 1). */
  serviceCount?: number;
  /** How far ahead to look, in days (default 90). */
  daysAhead?: number;
  /** Only alert on slots on/before this date, "YYYY-MM-DD". */
  notAfter?: string;
  /** Set for captcha-gated services — routes the request through PROXY_URL in CI. */
  captcha?: boolean;
}

/**
 * A watch entry whose officeId must be valid for its serviceId. Distributing
 * over the watchable services gives per-service office constraints.
 */
export type WatchEntry = {
  [S in WatchableServiceId]: WatchEntryBase & { serviceId: S; officeId: OfficeForService<S> };
}[WatchableServiceId];

export const WATCHLIST = [
  { name: "Führerschein-Umschreibung (ausländisch)", serviceId: 1071896, officeId: 10308174 },
  { name: "Einbürgerung", serviceId: 1071907, officeId: 10471 },
  {
    name: "Notfall-Hilfe Aufenthaltstitel – Beschäftigte/Angehörige",
    serviceId: 10339028,
    officeId: 10461,
    captcha: true,
  },
] as const satisfies readonly WatchEntry[];
