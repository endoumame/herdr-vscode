import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

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
 */
export async function realpathOrSelf(p: string): Promise<string> {
	try {
		return await fs.realpath(p);
	} catch {
		return p;
	}
}

export async function dedupeRealpaths(paths: readonly string[]): Promise<string[]> {
	const out = new Set<string>();
	for (const p of paths) {
		out.add(p);
		out.add(await realpathOrSelf(p));
	}
	return [...out];
}
