import * as vscode from 'vscode';

import { dedupeRealpaths } from './paths.js';

/** Minimal shape of the built-in git extension's exported API. */
interface GitExtensionExports {
	getAPI(version: 1): { repositories: { rootUri: vscode.Uri }[] };
}

/**
 * Every path that could plausibly be a repository root, used both to
 * relativise file paths and to match an agent's cwd.
 *
 * Symlinks are resolved on the way out: herdr reports a resolved cwd, so
 * without this, macOS `/tmp` vs `/private/tmp` and symlinked home directories
 * produce a silent zero-match.
 */
export async function collectRoots(extraRoots: readonly string[] = []): Promise<string[]> {
	const roots = new Set<string>(extraRoots);

	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		if (folder.uri.scheme === 'file') {
			roots.add(folder.uri.fsPath);
		}
	}

	try {
		const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
		if (ext) {
			const exports = ext.isActive ? ext.exports : await ext.activate();
			for (const repo of exports.getAPI(1).repositories) {
				if (repo.rootUri.scheme === 'file') {
					roots.add(repo.rootUri.fsPath);
				}
			}
		}
	} catch {
		// The git extension is optional; workspace folders alone are workable.
	}

	return dedupeRealpaths([...roots]);
}
