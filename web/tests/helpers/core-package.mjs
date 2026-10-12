// Where a core (repo-root) dependency is installed, as Node would resolve it for
// a file in the core checkout.
//
// A web suite that copies a core module into a throwaway directory has to put
// that module's packages within reach of the copy. `<core>/node_modules` is the
// obvious place to take them from and the wrong one: a git worktree (for example
// one under `.claude/worktrees/<name>`) usually has no node_modules of its own,
// and core modules import fine there only because Node walks up into the main
// checkout's tree. A link to `<core>/node_modules` is then created dangling, the
// copied module cannot load its package, and the suite fails (or passes) on the
// fallback path instead of the behaviour it is about.
//
// So this walks the way Node's bare-specifier lookup does: `<dir>/node_modules/
// <pkg>` for the starting directory and then each parent, nearest first,
// skipping a `<dir>` that is itself named node_modules. A candidate counts only
// if it holds a package.json. Walked by hand because
// `require.resolve('<pkg>/package.json')` is something a package's `exports` map
// may refuse. Same rule as findInstalledPackage() in the root tests/helpers.mjs,
// restated here because suites under web/tests must run on web/ alone and do not
// import from the root suite.
import fs from "node:fs";
import path from "node:path";

/**
 * @param {string} pkg - Package name, scoped names included (`@scope/name`).
 * @param {string} fromDir - Directory the lookup starts from (the core checkout).
 * @returns {string | null} The package directory, or null when it is not installed.
 */
export function findCorePackage(pkg, fromDir) {
  let dir = path.resolve(fromDir);
  for (;;) {
    if (path.basename(dir) !== "node_modules") {
      const candidate = path.join(dir, "node_modules", pkg);
      if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Make one core dependency importable from `sandboxDir` by linking the installed
 * package into the sandbox's own node_modules.
 *
 * One package, not the whole tree: Node resolves the linked package's own
 * imports from its real location, so its dependencies come along without being
 * linked. 'junction' is the link type Windows grants without Developer Mode and
 * is ignored elsewhere; the copy is the last resort.
 *
 * @param {string} sandboxDir - Directory the copied core module lives in.
 * @param {string} pkg - Package the copied module imports.
 * @param {string} fromDir - The core checkout the package is resolved for.
 * @returns {string} Path to the package inside the sandbox.
 * @throws {Error} When the package is not installed anywhere Node would look.
 */
export function linkCorePackage(sandboxDir, pkg, fromDir) {
  const source = findCorePackage(pkg, fromDir);
  if (source === null) {
    throw new Error(`${pkg} is not installed in any node_modules from ${fromDir} upward`);
  }
  const dest = path.join(sandboxDir, "node_modules", pkg);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.symlinkSync(source, dest, "junction");
  } catch {
    fs.cpSync(source, dest, { recursive: true });
  }
  return dest;
}
