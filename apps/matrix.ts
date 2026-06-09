// Emits the watch-list as JSON for the GitHub Actions matrix.
//   bun apps/matrix.ts            -> all watched services
//   bun apps/matrix.ts <filter>   -> only services whose id equals, or name contains, <filter>
import { WATCHLIST } from "../libs/watchlist";

const filter = (process.argv[2] ?? "").trim().toLowerCase();
const list = filter
  ? WATCHLIST.filter((e) => String(e.serviceId) === filter || e.name.toLowerCase().includes(filter))
  : WATCHLIST;

process.stdout.write(JSON.stringify(list));
