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
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			const input: unknown = tab.input;
			if (!(input instanceof vscode.TabInputTextDiff)) {
				continue;
			}
			if (sameUri(input.original, uri)) {
				return 'base';
			}
			if (sameUri(input.modified, uri)) {
				return 'head';
			}
		}
	}
	return undefined;
}

/**
 * Component-wise, rather than comparing `toString()` output.
 *
 * A `Uri`'s components are already normalised, so this decides the same
 * question — but `toString()` percent-encodes the whole URI on every call, and
 * this runs against both sides of every open diff tab. The scheme is checked
 * first because it rules out most tabs in one comparison, and `query` carries
 * the diff parameters, which are the longest part.
 */
function sameUri(a: vscode.Uri, b: vscode.Uri): boolean {
	return (
		a.scheme === b.scheme &&
		a.path === b.path &&
		a.authority === b.authority &&
		a.fragment === b.fragment &&
		a.query === b.query
	);
}
