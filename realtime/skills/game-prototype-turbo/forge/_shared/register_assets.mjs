// Let Node resolve the browser's absolute /assets/... specifiers.
//
// A shared module has to run in two places: in the page, where serve_step.py serves
// the project root so `/assets/foo.js` is a URL, and in Node, where forge/check_rounds.py
// and the Node test suite import the same file with no browser at all.
//
// Node reads a leading slash as a filesystem path from the root, so the same import
// that works in the page fails with ERR_MODULE_NOT_FOUND here. This hook rewrites the
// specifier for Node, so one module serves both without a special case.
//
// Uses `registerHooks` (synchronous, in-thread) rather than `register`, which Node
// 26 deprecates in DEP0205.
//
// Register it with:
//   node --import ./forge/_shared/register_assets.mjs your-script.mjs

import { registerHooks } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = process.env.GBU_PROJECT_ROOT
  ? resolvePath(process.env.GBU_PROJECT_ROOT)
  : resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Only project URL specifiers are rewritten. Bare specifiers
    // ("three") and relative ones fall through, so node_modules still resolves
    // the way Node intends.
    if (['/assets/', '/runs/', '/tmp/'].some(prefix => specifier.startsWith(prefix))) {
      const onDisk = resolvePath(PROJECT_ROOT, `.${specifier}`);
      return nextResolve(pathToFileURL(onDisk).href, context);
    }
    return nextResolve(specifier, context);
  },
});
