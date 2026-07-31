/**
 * Exact replication of herdr-reviewr's `src/export.rs`.
 *
 * The agent receives this text verbatim, so the format is a contract:
 *
 *     path/to/file.py:40-41
 *     -from .z import w
 *     +from .x import y
 *     this import path looks wrong
 *
 * Comments are sorted by (file, start line) and joined with a blank line. No
 * preamble, header or footer.
 */

export interface ExportLocation {
	/** Repository-relative, POSIX separators. */
	path: string;
	/** 1-based, inclusive. */
	startLine: number;
	/** 1-based, inclusive. */
	endLine: number;
	isBaseSide: boolean;
}

export interface ExportableComment {
	location: ExportLocation;
	snippet: readonly string[];
	text: string;
}

/**
 * reviewr's `normalize_text`: strip CRs, trim trailing whitespace, drop blank
 * lines.
 *
 * Dropping blank lines is load-bearing, not cosmetic — a blank line inside a
 * comment body would otherwise produce a "\n\n" that reads as the separator
 * between two comments, splitting one block into two malformed ones.
 */
export function normalizeText(text: string): string {
	return text
		.split('\n')
		.map(line => line.split('\r').join('').replace(/[ \t]+$/, ''))
		.filter(line => line.length > 0)
		.join('\n');
}

/** `path/to/file.py:40-41`, `file.rs:3`, `a.rs:38 (removed)` */
export function formatLocation(loc: ExportLocation): string {
	const span = loc.startLine === loc.endLine ? `${loc.startLine}` : `${loc.startLine}-${loc.endLine}`;
	return `${loc.path}:${span}${loc.isBaseSide ? ' (removed)' : ''}`;
}

/** reviewr: `format!("{}\n{}\n{}", location, lines, normalize_text(text))` */
export function formatComment(comment: ExportableComment): string {
	const head = formatLocation(comment.location);
	const body = normalizeText(comment.text);
	// With no snippet the three-part form would emit `head\n\nbody`, an
	// accidental block separator. Fall back to two parts.
	if (comment.snippet.length === 0) {
		return `${head}\n${body}`;
	}
	return `${head}\n${comment.snippet.join('\n')}\n${body}`;
}

export function exportComments(comments: readonly ExportableComment[]): string {
	return [...comments]
		.sort(
			(a, b) =>
				byteOrder(a.location.path, b.location.path) || a.location.startLine - b.location.startLine,
		)
		.map(formatComment)
		.join('\n\n');
}

/** Prepend an optional preamble, separated by the same blank line. */
export function exportWithPreamble(
	comments: readonly ExportableComment[],
	preamble: string,
): string {
	const body = exportComments(comments);
	const head = normalizeText(preamble);
	return head.length > 0 ? `${head}\n\n${body}` : body;
}

/**
 * Rust's `String: Ord` is byte order. `localeCompare` is ICU collation and
 * orders case and punctuation differently — `'B.rs'.localeCompare('a.rs')` is
 * 1, but in byte order 'B.rs' sorts first. Using it here would silently
 * reorder the payload relative to reviewr.
 */
function byteOrder(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
