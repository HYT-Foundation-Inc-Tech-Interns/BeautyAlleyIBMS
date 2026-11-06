#!/usr/bin/env node
/**
 * Role-map drift check.
 *
 * `SCOPE` in `src/auth/AuthProvider.tsx` is the client-side mirror of the
 * backend's `requireRole` calls. It has drifted twice: the desk could not open
 * the client records its API allowed, and the owner could not open the task
 * board its API allowed. Both are invisible in a build and only show up as a
 * missing nav item in front of a user.
 *
 * There is no frontend test runner, so this script reads the SCOPE literal
 * directly and compares it with `tools/roles.expected.json`. Editing one without
 * the other fails CI. The JSON is the contract; SCOPE is the implementation.
 *
 *   node tools/check-roles.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sourcePath = join(root, "src", "auth", "AuthProvider.tsx");
const expectedPath = join(here, "roles.expected.json");

const source = readFileSync(sourcePath, "utf8");
const expected = JSON.parse(readFileSync(expectedPath, "utf8"));

function extractScope(text) {
  const start = text.indexOf("export const SCOPE");
  if (start === -1) throw new Error("Could not find `export const SCOPE` in AuthProvider.tsx");
  const open = text.indexOf("{", start);
  if (open === -1) throw new Error("SCOPE has no object literal");

  // Walk braces so a nested array or comment cannot end the object early.
  let depth = 0;
  let end = -1;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error("SCOPE object literal is not closed");

  const body = text.slice(open + 1, end);
  const result = {};
  const roleRe = /([A-Z]+)\s*:\s*\[([\s\S]*?)\]/g;
  let m;
  while ((m = roleRe.exec(body)) !== null) {
    result[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  }
  return result;
}

const actual = extractScope(source);

const problems = [];
const roles = new Set([...Object.keys(expected), ...Object.keys(actual)]);

for (const role of roles) {
  const want = new Set(expected[role] ?? []);
  const got = new Set(actual[role] ?? []);
  for (const area of want) {
    if (!got.has(area)) problems.push(`${role} is missing "${area}" (expected, not in SCOPE)`);
  }
  for (const area of got) {
    if (!want.has(area)) problems.push(`${role} has unexpected "${area}" (in SCOPE, not expected)`);
  }
}

// An area nobody can reach is dead code; an area in no role is a typo.
const allAreas = new Set(Object.values(actual).flat());
const declaredAreas = [...source.matchAll(/^\s*\|\s*"([a-z-]+)"/gm)].map((m) => m[1]);
for (const area of declaredAreas) {
  if (!allAreas.has(area)) problems.push(`Area "${area}" is declared in the union but no role has it`);
}

if (problems.length) {
  console.error("Role map drift:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nFix SCOPE in src/auth/AuthProvider.tsx, or update tools/roles.expected.json if the change is intended.",
  );
  process.exit(1);
}

console.log(`Role map OK — ${roles.size} roles, ${allAreas.size} areas.`);
