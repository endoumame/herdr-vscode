/**
 * Maps an editor URI plus a line range onto a repository-relative location.
 *
 * The GitHub Pull Requests extension encodes its diff parameters as
 * `JSON.stringify(params)` in `uri.query` and reads them back with a plain
 * `JSON.parse` — no URL encoding on either side, so decoding here would
 * corrupt any payload containing a `%`.
 *
 * Those parameter shapes are internal to that extension. Everything below is
 * duck-typed and wrapped in try/catch: a shape change must degrade to the
 * `unknown` fallback, never throw in the user's face.
 */

import { toPosix } from '../util/text.js';

/** Structural stand-in for `vscode.Uri`, so this module stays vscode-free. */
export interface UriLike {
	readonly scheme: string;
	readonly path: string;
	readonly query: string;
}

export type LocationKind = 'file' | 'diff' | 'commit' | 'unknown';

export interface ResolvedLocation {
	/** Repository-relative where possible, POSIX separators. */
	path: string;
	/** 1-based, inclusive. */
	startLine: number;
	/** 1-based, inclusive. */
	endLine: number;
	isBaseSide: boolean;
	kind: LocationKind;
}

export interface ResolveOptions {
	/** 0-based, inclusive. */
	startLine: number;
	/** 0-based, inclusive. */
	endLine: number;
	/** Known repository / workspace roots, absolute, for relativising `file:` URIs. */
	roots?: readonly string[];
	/** Called once per unrecognised scheme, for diagnostics. */
	onUnknownScheme?: (scheme: string) => void;
}

export function resolveLocation(uri: UriLike, opts: ResolveOptions): ResolvedLocation | null {
	const startLine = Math.min(opts.startLine, opts.endLine) + 1;
	const endLine = Math.max(opts.startLine, opts.endLine) + 1;
	const roots = opts.roots ?? [];
	const query = parseQuery(uri.query);

	const base = resolveByScheme(uri, query, roots, opts.onUnknownScheme);
	if (base === null) {
		return null;
	}
	return { ...base, startLine, endLine };
}

type PartialLocation = Pick<ResolvedLocation, 'path' | 'isBaseSide' | 'kind'>;

function resolveByScheme(
	uri: UriLike,
	q: Record<string, unknown>,
	roots: readonly string[],
	onUnknownScheme: ((scheme: string) => void) | undefined,
): PartialLocation | null {
	switch (uri.scheme) {
		case 'file':
			return { path: relativeToRoots(uri.path, roots), isBaseSide: false, kind: 'file' };

		case 'review': {
			// ReviewUriParams { path, ref, commit, base, isOutdated, rootPath }
			const filePath = str(q['path']) ?? uri.path;
			const rootPath = str(q['rootPath']);
			const rel = rootPath ? relativeTo(filePath, rootPath) : relativeToRoots(filePath, roots);
			return { path: rel, isBaseSide: q['base'] === true, kind: 'diff' };
		}

		case 'pr': {
			// PRUriParams { fileName, previousFileName?, isBase, ... }
			const isBase = q['isBase'] === true;
			const previous = str(q['previousFileName']);
			// On the base side of a rename, the file is still at its old path.
			const fileName = (isBase && previous) || str(q['fileName']);
			if (!fileName) {
				return fallback(uri, roots, onUnknownScheme);
			}
			return { path: toPosix(fileName), isBaseSide: isBase, kind: 'diff' };
		}

		case 'githubpr':
		case 'gitpr': {
			if (q['isEmpty'] === true) {
				return null; // the create-PR flow's placeholder for "no such file on this side"
			}
			const fileName = str(q['fileName']);
			if (!fileName) {
				return fallback(uri, roots, onUnknownScheme);
			}
			return { path: toPosix(fileName), isBaseSide: false, kind: 'diff' };
		}

		case 'githubcommit':
			// query is { commit, owner, repo }; the path rides on the URI itself.
			return { path: stripLeadingSlash(uri.path), isBaseSide: false, kind: 'commit' };

		case 'git': {
			// VS Code's built-in SCM diff. ref '' means index/working tree.
			const filePath = str(q['path']) ?? uri.path;
			const ref = q['ref'];
			return {
				path: relativeToRoots(filePath, roots),
				isBaseSide: typeof ref === 'string' && ref.length > 0,
				kind: 'diff',
			};
		}

		case 'filechange':
		case 'prnode': {
			const fileName = str(q['fileName']) ?? str(q['path']) ?? str(q['filePath']);
			const isBase = q['isBase'] === true || q['base'] === true;
			return {
				path: fileName ? toPosix(fileName) : stripLeadingSlash(uri.path),
				isBaseSide: isBase,
				kind: 'diff',
			};
		}

		case 'vscode-vfs':
			// Remote Repositories: /owner/repo/path/to/file
			return { path: stripRepoPrefix(uri.path), isBaseSide: false, kind: 'file' };

		case 'untitled':
			return { path: stripLeadingSlash(uri.path), isBaseSide: false, kind: 'unknown' };

		default:
			return fallback(uri, roots, onUnknownScheme);
	}
}

function fallback(
	uri: UriLike,
	roots: readonly string[],
	onUnknownScheme: ((scheme: string) => void) | undefined,
): PartialLocation {
	onUnknownScheme?.(uri.scheme);
	const relative = relativeToRoots(uri.path, roots);
	// Only a `file:` URI's path is a real filesystem path worth keeping absolute
	// when it sits outside every root. For the virtual schemes the path is
	// already repository-relative bar a leading slash.
	const path = uri.scheme === 'file' ? relative : dropLeadingSlashes(relative);
	return { path, isBaseSide: false, kind: 'unknown' };
}

function parseQuery(query: string): Record<string, unknown> {
	if (!query || !query.startsWith('{')) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(query);
		return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function str(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stripLeadingSlash(p: string): string {
	return dropLeadingSlashes(toPosix(p));
}

function dropLeadingSlashes(p: string): string {
	let i = 0;
	while (i < p.length && p.charCodeAt(i) === 47) {
		i++;
	}
	return i === 0 ? p : p.slice(i);
}

function dropTrailingSlashes(p: string): string {
	let end = p.length;
	while (end > 0 && p.charCodeAt(end - 1) === 47) {
		end--;
	}
	return end === p.length ? p : p.slice(0, end);
}

/**
 * Relativise against the longest matching root. Falls back to the absolute
 * path rather than emitting `../..` — an agent can act on an absolute path,
 * whereas a `..`-prefixed one is meaningless without knowing the cwd.
 */
export function relativeToRoots(filePath: string, roots: readonly string[]): string {
	const target = toPosix(filePath);
	let best: string | undefined;
	for (const root of roots) {
		const normalized = dropTrailingSlashes(toPosix(root));
		if (!normalized) {
			continue;
		}
		if (target === normalized || target.startsWith(normalized + '/')) {
			if (best === undefined || normalized.length > best.length) {
				best = normalized;
			}
		}
	}
	return best === undefined ? target : target.slice(best.length + 1);
}

function relativeTo(filePath: string, root: string): string {
	return relativeToRoots(filePath, [root]);
}

function stripRepoPrefix(p: string): string {
	const parts = stripLeadingSlash(p).split('/');
	return parts.length > 2 ? parts.slice(2).join('/') : parts.join('/');
}
