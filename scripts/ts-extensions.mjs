/**
 * Module-resolution hook, so Node can run the TypeScript sources directly.
 *
 * Two things stand between Node's ESM resolver and this codebase, and both are
 * about the sources being written for Next's bundler rather than for Node:
 *
 *  1. **Extensionless relative imports.** `from "./format"` is what
 *     `moduleResolution: "bundler"` expects; Node insists on a real filename.
 *     A failed relative resolution is retried with `.ts`, then `/index.ts`.
 *
 *  2. **The `@/` alias.** Declared in tsconfig paths and used by everything under
 *     app/. Node knows nothing about tsconfig, so the alias is rewritten to a
 *     file URL under the project root.
 *
 * Doing it here rather than littering the sources with `.ts` extensions and
 * relative `../../..` chains is the point: `npm run verify` executes the real
 * modules — the same files Next compiles — with no dependencies and no build
 * step. Node 22.18+/24 strips the type annotations natively.
 *
 * Used as:  node --import ./scripts/ts-extensions.mjs scripts/verify.mjs
 */

import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(`${projectRoot}/`).href;

// The hooks run on a separate thread, so they are passed as source rather than as
// a path back into this file — registering this module from itself would re-run
// the registration inside the hooks thread. The project root is interpolated in
// because that thread has no view of this module's scope.
const hooks = `
const ROOT = ${JSON.stringify(rootUrl)};

async function withExtension(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (/\\.[cm]?[jt]sx?$/.test(specifier)) throw err;
    try {
      return await nextResolve(specifier + ".ts", context);
    } catch {
      try {
        return await nextResolve(specifier + "/index.ts", context);
      } catch {
        throw err;
      }
    }
  }
}

export async function resolve(specifier, context, nextResolve) {
  // tsconfig's "@/*": ["./*"] alias.
  if (specifier.startsWith("@/")) {
    const target = new URL(specifier.slice(2), ROOT).href;
    return withExtension(target, context, nextResolve);
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return withExtension(specifier, context, nextResolve);
  }
  return nextResolve(specifier, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(hooks)}`, import.meta.url);
