import * as vscode from 'vscode';

import type { ResolvedLocation } from './location.js';

/**
 * Decide which side of a diff a document is on, by looking at the open tabs.
 *
 * This is needed because the scheme alone is not enough. For a checked-out
 * pull request the GitHub Pull Requests extension opens the diff as
 * `review:` (base) on the left and the *real file on disk* (`file:`) on the
 * right — only deleted files get a `review:` URI on both sides. So a `file:`
 * document may be an ordinary file or the head side of a PR diff, and the
 * difference decides whether the snippet gets a `+` prefix.
 */
export function applyDiffSide(uri: vscode.Uri, loc: ResolvedLocation): ResolvedLocation {
	const side = diffSideOf(uri);
	if (side === undefined) {
		return loc;
	}
	return { ...loc, isBaseSide: side === 'base', kind: 'diff' };
}

function diffSideOf(uri: vscode.Uri): 'base' | 'head' | undefined {
	const target = uri.toString();
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			const input: unknown = tab.input;
			if (!(input instanceof vscode.TabInputTextDiff)) {
				continue;
			}
			if (input.original.toString() === target) {
				return 'base';
			}
			if (input.modified.toString() === target) {
				return 'head';
			}
		}
	}
	return undefined;
}
