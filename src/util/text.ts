/**
 * Line-level string helpers on the payload hot path.
 *
 * Every one of these runs once per selected line of every comment, and the
 * overwhelmingly common case is a line that needs no change at all. Each
 * function therefore scans first and only allocates when there is something to
 * rewrite, returning the original string otherwise — `split().join()` and
 * `replace()` allocate unconditionally.
 */

/** Remove every carriage return, wherever it sits. */
export function stripCr(text: string): string {
	return text.indexOf('\r') === -1 ? text : text.replaceAll('\r', '');
}

/** Trim trailing spaces and tabs, exactly as `/[ \t]+$/` does. */
export function rtrim(text: string): string {
	let end = text.length;
	while (end > 0) {
		const code = text.charCodeAt(end - 1);
		if (code !== 32 && code !== 9) {
			break;
		}
		end -= 1;
	}
	return end === text.length ? text : text.slice(0, end);
}

/** `rtrim(stripCr(line))`, the normalisation shared by snippets and export. */
export function normalizeLine(text: string): string {
	return rtrim(stripCr(text));
}

/** Windows separators to POSIX ones. */
export function toPosix(p: string): string {
	return p.indexOf('\\') === -1 ? p : p.replaceAll('\\', '/');
}

/**
 * The first line with something on it, elided to `maxLength`.
 *
 * Used for one-line labels. It walks the text a line at a time and stops at the
 * first hit, so a long body is never split into an array of lines just to show
 * its opening words. Falls back to the whole text when every line is blank,
 * matching what a `find` over the split lines would have yielded.
 */
export function firstNonBlankLine(text: string, maxLength: number): string {
	let start = 0;
	while (start < text.length) {
		const newline = text.indexOf('\n', start);
		const end = newline === -1 ? text.length : newline;
		if (!isBlank(text, start, end)) {
			return elide(text.slice(start, end), maxLength);
		}
		if (newline === -1) {
			break;
		}
		start = newline + 1;
	}
	return elide(text, maxLength);
}

const UNICODE_WHITESPACE = /\s/;

/** `String.prototype.trim`'s notion of whitespace, over a slice, without one. */
function isBlank(text: string, start: number, end: number): boolean {
	for (let i = start; i < end; i++) {
		const code = text.charCodeAt(i);
		if (code === 32 || (code >= 9 && code <= 13)) {
			continue; // space, tab, the line terminators, form feed
		}
		// Everything else that `trim` considers whitespace — no-break space, the
		// Unicode spaces, BOM — is non-ASCII, so the regex is a rare fallback.
		if (code > 127 && UNICODE_WHITESPACE.test(text.charAt(i))) {
			continue;
		}
		return false;
	}
	return true;
}

function elide(text: string, maxLength: number): string {
	return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
