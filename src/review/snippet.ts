import type { ResolvedLocation } from './location.js';

export type SnippetPrefix = 'auto' | 'diff' | 'none';

export interface SnippetOptions {
	snippetPrefix: SnippetPrefix;
	snippetMaxLines: number;
}

/**
 * Turn the selected document lines into the snippet block of a comment.
 *
 * herdr-reviewr reads real diff hunks, so every one of its snippet lines is
 * inherently `+` or `-` prefixed. A comment on an ordinary file is not a diff,
 * and prefixing it `+` would tell the agent a line was added when it wasn't —
 * hence `auto`.
 *
 * The prefix is also load-bearing for the wire format. `normalize_text` only
 * runs over the comment body, so a blank line in an unprefixed snippet emits a
 * literal "\n\n" and splits one comment into two malformed blocks. In diff
 * mode the prefix makes every line non-empty; in plain mode blanks are dropped
 * to preserve the same invariant.
 */
export function buildSnippet(
	docLines: readonly string[],
	loc: Pick<ResolvedLocation, 'kind' | 'isBaseSide'>,
	opts: SnippetOptions,
): string[] {
	if (opts.snippetMaxLines <= 0) {
		return [];
	}

	const useDiff =
		opts.snippetPrefix === 'diff' ||
		(opts.snippetPrefix === 'auto' && (loc.kind === 'diff' || loc.kind === 'commit'));
	const prefix = useDiff ? (loc.isBaseSide ? '-' : '+') : '';

	let lines = docLines.map(line => prefix + rtrim(stripCr(line)));

	if (lines.length > opts.snippetMaxLines) {
		const omitted = lines.length - opts.snippetMaxLines;
		lines = [
			...lines.slice(0, opts.snippetMaxLines),
			`${prefix}... (${omitted} more line${omitted === 1 ? '' : 's'} omitted)`,
		];
	}

	return useDiff ? lines : lines.filter(line => line.length > 0);
}

/**
 * Trailing whitespace is trimmed after prefixing, which is safe because the
 * prefix is non-whitespace: a blank source line in diff mode becomes exactly
 * `+`, non-empty and identical to what a real unified diff shows.
 */
function rtrim(text: string): string {
	return text.replace(/[ \t]+$/, '');
}

function stripCr(text: string): string {
	return text.split('\r').join('');
}
