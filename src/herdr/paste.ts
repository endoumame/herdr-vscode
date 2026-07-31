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
 * The removal loops rather than doing a single pass because stripping one
 * occurrence can splice a fresh one into existence — `"\x1b[20" + PASTE_END +
 * "1~"` collapses to exactly PASTE_END. reviewr's char-by-char scan has the
 * same property; `split().join()` would not.
 */
export function wrapBracketedPaste(text: string): string {
	let body = text;
	while (body.includes(PASTE_END)) {
		body = body.replace(PASTE_END, '');
	}
	return PASTE_START + body + PASTE_END;
}

/** Strip paste markers so a payload can be logged readably. */
export function stripPasteMarkers(text: string): string {
	return text.split(PASTE_START).join('').split(PASTE_END).join('');
}

/** Render control characters visibly, for the output channel. */
export function forLog(text: string): string {
	return stripPasteMarkers(text).replace(/\x1b/g, '<ESC>');
}
