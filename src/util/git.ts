import * as vscode from 'vscode';

import { memoizeAsync } from './memo.js';
import { dedupeRealpaths } from './paths.js';

/** Minimal shape of the built-in git extension's exported API. */
interface GitApi {
	repositories: { rootUri: vscode.Uri }[];
}

interface GitExtensionExports {
	getAPI(version: 1): GitApi;
}

/**
 * The git extension's API handle, looked up once.
 *
 * Only the handle is cached — `repositories` is read through it on every call,
 * so a repository opened or closed mid-session is still picked up. What is
 * avoided is re-running the extension lookup and the activation await for every
 * captured comment.
 *
 * Unavailability throws rather than resolving to `undefined`, because a
 * rejection is deliberately not memoised: an extension that has not registered
 * yet must be retried on the next capture, not written off for the session.
 */
const gitApi = memoizeAsync<GitApi>(async () => {
	const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
	if (!ext) {
		throw new Error('the vscode.git extension is not available');
	}
	const exports = ext.isActive ? ext.exports : await ext.activate();
	return exports.getAPI(1);
});

/**
 * Every path that could plausibly be a repository root, used both to
 * relativise file paths and to match an agent's cwd.
 *
 * Symlinks are resolved on the way out: herdr reports a resolved cwd, so
 * without this, macOS `/tmp` vs `/private/tmp` and symlinked home directories
 * produce a silent zero-match. Those resolutions are memoised in `paths.ts`, so
 * the repeat calls this makes per comment cost no syscalls.
 */
export async function collectRoots(extraRoots: Iterable<string> = []): Promise<string[]> {
	// An iterable, so a caller holding a Set need not copy it into an array
	// on every captured comment.
	const roots = new Set<string>(extraRoots);

	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		if (folder.uri.scheme === 'file') {
			roots.add(folder.uri.fsPath);
		}
	}

	try {
		for (const repo of (await gitApi.get()).repositories) {
			if (repo.rootUri.scheme === 'file') {
				roots.add(repo.rootUri.fsPath);
			}
		}
	} catch {
		// The git extension is optional; workspace folders alone are workable.
	}

	return dedupeRealpaths([...roots]);
}
