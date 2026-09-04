/**
 * Lets bare `node` run the sidecar straight from TypeScript source.
 *
 * Node 24 strips types, but it resolves specifiers literally: the workspace
 * packages ship `src/*.ts` and import each other as `./prices.js`, a file that
 * only exists as `.ts`. Map those to the sibling `.ts` when there is one.
 *
 * ponytail: dev-time resolution only. Packaging the app will bundle the sidecar
 * (or ship a Node SEA), and this hook goes away with it.
 */

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && specifier.endsWith(".js")) {
      const candidate = new URL(`${specifier.slice(0, -".js".length)}.ts`, context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});
