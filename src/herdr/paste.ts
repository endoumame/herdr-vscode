/**
 * Bracketed paste (DEC 2004) wrapping, mirroring herdr-reviewr's `pasted()`.
 *
 * herdr's `pane send-text` writes bytes straight into the pane's input. A
 * paste is inserted verbatim in any input mode, whereas raw bytes execute as
 * commands in a vim-style input sitting in normal mode — which is why the
 * payload has to be wrapped rather than sent bare.
 */

export const PASTE_START = '\x1b[200~';
export const PASTE_END = '\x1b[201~';

/**
 * Wrap `text` for bracketed paste.
 *
 * Any embedded PASTE_END is stripped first: the protocol has no escaping
 * mechanism, so an ESC[201~ inside the payload would end the paste early and
 * leave the remainder to be interpreted as keystrokes.
 *
 * Stripping one occurrence can splice a fresh one into existence — `"\x1b[20" +
 * PASTE_END + "1~"` collapses to exactly PASTE_END — so a single `split().join()`
 * is not enough. Rescanning from the start after every removal is, but it
 * rebuilds the whole payload each time: a review pasted out of a terminal can
 * carry thousands of escape sequences, and at that point the quadratic cost is
 * seconds of blocked extension host.
 *
 * Instead this is reviewr's char-by-char scan, done in one pass: append, and
 * whenever the tail of the output has become a marker, drop it. PASTE_END has
 * no proper border (its ESC never recurs), so removal is confluent and the
 * result is identical to repeated leftmost removal.
 */
export function wrapBracketedPaste(text: string): string {
	// Overwhelmingly the common case, and it copies nothing.
	if (!text.includes(PASTE_END)) {
		return PASTE_START + text + PASTE_END;
	}
	return PASTE_START + stripTerminators(text) + PASTE_END;
}

/** PASTE_END is pure ASCII, so a code-unit scan can never split a surrogate pair. */
const END_CODES: readonly number[] = Array.from(PASTE_END, c => c.charCodeAt(0));

function stripTerminators(text: string): string {
	// Two bytes per code unit and released as soon as the string is built —
	// an array of one-character strings would cost an object apiece.
	const kept = new Uint16Array(text.length);
	const width = END_CODES.length;
	const last = END_CODES[width - 1];
	let length = 0;

	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		kept[length++] = code;
		if (code === last && length >= width && endsWithTerminator(kept, length, width)) {
			length -= width;
		}
	}

	return fromCodes(kept, length);
}

function endsWithTerminator(kept: Uint16Array, length: number, width: number): boolean {
	// The trailing unit is already known to match; walk back from the one before.
	for (let i = width - 2; i >= 0; i--) {
		if (kept[length - width + i] !== END_CODES[i]) {
			return false;
		}
	}
	return true;
}

/** `String.fromCharCode` takes its arguments on the stack, hence the chunking. */
function fromCodes(codes: Uint16Array, length: number): string {
	const CHUNK = 4096;
	if (length <= CHUNK) {
		return String.fromCharCode(...codes.subarray(0, length));
	}
	const parts: string[] = [];
	for (let i = 0; i < length; i += CHUNK) {
		parts.push(String.fromCharCode(...codes.subarray(i, Math.min(i + CHUNK, length))));
	}
	return parts.join('');
}

/**
 * Terminate the payload with a newline.
 *
 * `pane send-text` leaves the agent's cursor wherever the text ended, so
 * without this the next send starts on the same line as the previous one's
 * last comment and the two run together.
 *
 * Callers must apply this *before* wrapping: inside the bracketed-paste
 * markers a terminal inserts the newline literally, whereas a bare one is an
 * Enter. With `herdr.bracketedPaste` set to `never` — which assumes herdr
 * wraps server-side instead — that distinction is herdr's to make.
 */
export function withTrailingNewline(text: string): string {
	return text.endsWith('\n') ? text : text + '\n';
}

/**
 * Strip paste markers so a payload can be logged readably.
 *
 * Both of these run over the whole payload on every send purely to produce a
 * debug line, so each step is skipped outright when there is nothing to do.
 */
export function stripPasteMarkers(text: string): string {
	let out = text.includes(PASTE_START) ? text.replaceAll(PASTE_START, '') : text;
	if (out.includes(PASTE_END)) {
		out = out.replaceAll(PASTE_END, '');
	}
	return out;
}

/** Render control characters visibly, for the output channel. */
export function forLog(text: string): string {
	const stripped = stripPasteMarkers(text);
	return stripped.indexOf('\x1b') === -1 ? stripped : stripped.replaceAll('\x1b', '<ESC>');
}
