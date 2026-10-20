import { dirname, join, resolve } from "node:path";

/**
 * Where `ui compare` keeps the base worktree for the merge-base `sha`:
 * `<main checkout>/../banki-worktrees/.base-<12-char sha>`. The main checkout
 * is the parent of the git common dir (`git rev-parse --git-common-dir`),
 * which every worktree shares, so they all resolve the same path.
 */
export function baseWorktreePath(gitCommonDir: string, sha: string): string {
  const mainCheckout = dirname(resolve(gitCommonDir));
  return join(mainCheckout, "..", "banki-worktrees", `.base-${sha.slice(0, 12)}`);
}
