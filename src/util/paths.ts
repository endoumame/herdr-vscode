import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { memoizeKeyed } from './memo.js';

export function expandHome(p: string): string {
	if (p === '~') {
		return os.homedir();
	}
	if (p.startsWith('~/') || p.startsWith('~\\')) {
		return path.join(os.homedir(), p.slice(2));
	}
	return p;
}

export async function isExecutable(p: string): Promise<boolean> {
	try {
		const stat = await fs.stat(p);
		if (!stat.isFile()) {
			return false;
		}
		await fs.access(p, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve symlinks on both sides of a path comparison. Without this, macOS
 * `/tmp` vs `/private/tmp` and symlinked home directories produce a silent
 * zero-match when pairing an agent's cwd with a workspace root.
 *
 * The answers are memoised. Root discovery runs on every captured comment and
 * on every target resolution, and a repository root does not move underneath a
 * running window — re-walking the same symlink chains each time is a syscall
 * per root per comment for an answer that never changes. A lookup that failed
 * is not cached, so a directory that appears later is still picked up.
 */
const realpaths = memoizeKeyed((p: string) => fs.realpath(p));

export function invalidateRealpathCache(): void {
	realpaths.invalidate();
}

export async function realpathOrSelf(p: string): Promise<string> {
	try {
		return await realpaths.get(p);
	} catch {
		return p;
	}
}

export async function dedupeRealpaths(paths: readonly string[]): Promise<string[]> {
	if (paths.length === 0) {
		return [];
	}
	// Resolved in parallel: these are independent stat walks, and serialising
	// them makes root discovery as slow as the sum of its roots.
	const resolved = await Promise.all(paths.map(realpathOrSelf));
	const out = new Set<string>();
	for (let i = 0; i < paths.length; i++) {
		out.add(paths[i] as string);
		out.add(resolved[i] as string);
	}
	return [...out];
}
