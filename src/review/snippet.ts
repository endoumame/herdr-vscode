import { normalizeLine } from '../util/text.js';

import type { ResolvedLocation } from './location.js';

export type SnippetPrefix = 'auto' | 'diff' | 'none';

export interface SnippetOptions {
	snippetPrefix: SnippetPrefix;
	snippetMaxLines: number;
	/**
	 * How many lines the selection really spans, when `docLines` has already
	 * been cut down to what survives truncation. Defaults to `docLines.length`.
	 */
	totalLines?: number;
}

/**
 * How many lines a caller needs to read for `buildSnippet` to produce the same
 * result as reading the whole selection. Zero means the document need not be
 * opened at all.
 */
export function snippetLinesToRead(opts: Pick<SnippetOptions, 'snippetMaxLines'>): number {
	return opts.snippetMaxLines > 0 ? opts.snippetMaxLines : 0;
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
	const max = opts.snippetMaxLines;
	if (max <= 0) {
		return [];
	}

	const useDiff =
		opts.snippetPrefix === 'diff' ||
		(opts.snippetPrefix === 'auto' && (loc.kind === 'diff' || loc.kind === 'commit'));
	const prefix = useDiff ? (loc.isBaseSide ? '-' : '+') : '';

	// Truncate before normalising: the caller may have read only `max` lines,
	// and normalising lines that are about to be dropped is wasted work either
	// way. Trailing whitespace is trimmed after prefixing, which is safe because
	// the prefix is non-whitespace: a blank source line in diff mode becomes
	// exactly `+`, non-empty and identical to what a real unified diff shows.
	const total = opts.totalLines ?? docLines.length;
	const kept = Math.min(docLines.length, max);
	const lines: string[] = [];
	for (let i = 0; i < kept; i++) {
		const line = prefix + normalizeLine(docLines[i] as string);
		// A blank line in an unprefixed snippet would emit "\n\n" and split one
		// comment into two malformed blocks, so plain mode drops them — after
		// truncation, so the kept lines and the omitted count are unaffected.
		if (useDiff || line.length > 0) {
			lines.push(line);
		}
	}

	if (total > max) {
		const omitted = total - max;
		lines.push(`${prefix}... (${omitted} more line${omitted === 1 ? '' : 's'} omitted)`);
	}

	return lines;
}
