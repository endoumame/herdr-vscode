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

import { normalizeLine } from '../util/text.js';

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
 *
 * A typed review comment is nearly always already in this form, so the text is
 * scanned before anything is built: the common case returns the original string
 * and allocates nothing at all, rather than paying for a split, a per-line
 * split/join, a map, a filter and a join.
 */
export function normalizeText(text: string): string {
	return isNormalized(text) ? text : rebuildNormalized(text);
}

const LF = 10;
const CR = 13;
const SPACE = 32;
const TAB = 9;

/** True when `rebuildNormalized` would hand back exactly what it was given. */
function isNormalized(text: string): boolean {
	let lineStart = 0;
	// One past the end stands in for a final newline, so the last line is
	// checked by the same branch as every other.
	for (let i = 0; i <= text.length; i++) {
		const code = i < text.length ? text.charCodeAt(i) : LF;
		if (code === CR) {
			return false;
		}
		if (code !== LF) {
			continue;
		}
		if (i === lineStart) {
			return false; // a blank line, including a trailing newline
		}
		const previous = text.charCodeAt(i - 1);
		if (previous === SPACE || previous === TAB) {
			return false;
		}
		lineStart = i + 1;
	}
	return true;
}

function rebuildNormalized(text: string): string {
	const lines: string[] = [];
	let start = 0;
	for (;;) {
		const newline = text.indexOf('\n', start);
		const line = normalizeLine(newline === -1 ? text.slice(start) : text.slice(start, newline));
		if (line.length > 0) {
			lines.push(line);
		}
		if (newline === -1) {
			return lines.join('\n');
		}
		start = newline + 1;
	}
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
