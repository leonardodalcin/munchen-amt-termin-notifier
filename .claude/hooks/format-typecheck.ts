#!/usr/bin/env bun
/*
 * Claude Code PostToolUse hook: after an Edit/Write, format the changed file
 * with oxfmt and type-check the project with tsc. Wired up in .claude/settings.json.
 * Exits 2 on type errors so Claude sees the failure and can fix it.
 */
import { existsSync } from "node:fs";

const input = (await Bun.stdin.json().catch(() => ({}))) as {
  tool_input?: { file_path?: string };
};
const file = input.tool_input?.file_path ?? "";

const oxfmt = "./node_modules/.bin/oxfmt";
const tsc = "./node_modules/.bin/tsc";

// Auto-format the changed file (oxfmt handles ts/js/json/md).
if (
  /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|json|md)$/.test(file) &&
  existsSync(file) &&
  existsSync(oxfmt)
) {
  await Bun.$`${oxfmt} --write ${file}`.quiet().nothrow();
}

// Type-check the project when a TypeScript file changed.
if (/\.(ts|tsx|mts|cts)$/.test(file) && existsSync(tsc)) {
  const result = await Bun.$`${tsc} --noEmit`.quiet().nothrow();
  if (result.exitCode !== 0) {
    console.error("TypeScript errors:\n" + result.stdout.toString() + result.stderr.toString());
    process.exit(2);
  }
}
