/**
 * profile-path.mjs — where the web finds the user's `config/profile.yml`.
 *
 * A deliberate mirror of the core's `getProfilePath()` (path-resolver.mjs), not
 * a second design: Turbopack's root is pinned to `web/` and refuses modules
 * outside it (see next.config.mjs and profile-keywords.mjs's header), so the
 * core helper cannot be imported here. tests/web-profile-path-parity.test.mjs in
 * the root suite pins the contract below.
 *
 * `CAREER_OPS_PROFILE` names the profile file directly. It is honored when the
 * root is the web's own derived data root (`careerOpsRoot()`), which is every
 * call site in the app. A caller that states the tree it means passes
 * `explicitRoot: true` and gets `<root>/config/profile.yml`: the override does
 * not beat a root the caller named.
 *
 * A blank or whitespace-only value counts as unset. A relative value is anchored
 * to the codebase root, the checkout containing web/ (resolveCodeRoot(); the
 * same rule as CAREER_OPS_ROOT), never to the working directory, so it names the
 * same file whether the server runs from web/ or elsewhere. An absolute value is
 * returned unchanged. That rule lives in resolveOverride() alone.
 */
import path from "node:path";
import { resolveCodeRoot } from "./code-root.mjs";

function resolveOverride(value, codeRoot) {
  return path.resolve(codeRoot, value);
}

/**
 * @param {string} root Absolute data root (careerOpsRoot()).
 * @param {{ explicitRoot?: boolean, env?: Record<string, string | undefined>, codeRoot?: string }} [opts]
 * @returns {string} Absolute path to the profile file.
 */
export function getProfilePath(root, { explicitRoot = false, env = process.env, codeRoot } = {}) {
  const override = explicitRoot ? undefined : env.CAREER_OPS_PROFILE?.trim();
  return override ? resolveOverride(override, codeRoot ?? resolveCodeRoot(process.cwd(), env)) : path.join(root, "config", "profile.yml");
}
