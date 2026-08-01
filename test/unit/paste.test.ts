import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	PASTE_END,
	PASTE_START,
	forLog,
	stripPasteMarkers,
	withTrailingNewline,
	wrapBracketedPaste,
} from '../../src/herdr/paste.js';

test('wraps ordinary text', () => {
	assert.equal(wrapBracketedPaste('hello'), `${PASTE_START}hello${PASTE_END}`);
});

test('wraps an empty payload', () => {
	assert.equal(wrapBracketedPaste(''), `${PASTE_START}${PASTE_END}`);
});

test('strips an embedded paste terminator', () => {
	// Left in place it would end the paste early and leave the rest to be
	// interpreted as keystrokes.
	assert.equal(wrapBracketedPaste(`a${PASTE_END}b`), `${PASTE_START}ab${PASTE_END}`);
});

test('strips terminators that only appear after an earlier removal', () => {
	// Removing the middle marker splices the surrounding fragments into a new
	// one. A single pass would leave it behind.
	const input = `\x1b[20${PASTE_END}1~`;
	const wrapped = wrapBracketedPaste(input);
	assert.equal(wrapped, `${PASTE_START}${PASTE_END}`);
	assert.equal(wrapped.slice(PASTE_START.length, -PASTE_END.length).includes(PASTE_END), false);
});

test('collapses a chain of splices down to nothing', () => {
	// Each removal joins its neighbours into a fresh marker, three deep.
	const input = `\x1b[20\x1b[20${PASTE_END}1~1~`;
	assert.equal(wrapBracketedPaste(input), `${PASTE_START}${PASTE_END}`);
});

test('keeps a partial marker that never completes', () => {
	assert.equal(wrapBracketedPaste('\x1b[201'), `${PASTE_START}\x1b[201${PASTE_END}`);
	assert.equal(wrapBracketedPaste('\x1b[20'), `${PASTE_START}\x1b[20${PASTE_END}`);
});

test('strips every occurrence, not just the first', () => {
	const input = `a${PASTE_END}b${PASTE_END}c${PASTE_END}`;
	assert.equal(wrapBracketedPaste(input), `${PASTE_START}abc${PASTE_END}`);
});

test('leaves the paste introducer alone — only the terminator is dangerous', () => {
	assert.equal(
		wrapBracketedPaste(`a${PASTE_START}b`),
		`${PASTE_START}a${PASTE_START}b${PASTE_END}`,
	);
});

test('a payload dense with terminators does not cost quadratic time', () => {
	// A repeated scan-and-splice reallocates the whole payload per removal: at
	// 8000 markers in ~200 KB that is well over a second of blocked extension
	// host. Correctness first, then the budget that pins the complexity.
	const markers = 8000;
	const input = `${'x'.repeat(20)}${PASTE_END}`.repeat(markers);
	const started = process.hrtime.bigint();
	const wrapped = wrapBracketedPaste(input);
	const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

	assert.equal(wrapped, `${PASTE_START}${'x'.repeat(20).repeat(markers)}${PASTE_END}`);
	assert.equal(
		elapsedMs < 400,
		true,
		`wrapBracketedPaste took ${elapsedMs.toFixed(1)}ms for ${markers} markers`,
	);
});

test('an ordinary payload with no terminator is returned without rebuilding', () => {
	const body = 'a.rs:1\n+x\nlooks wrong';
	assert.equal(wrapBracketedPaste(body), `${PASTE_START}${body}${PASTE_END}`);
});

test('the one-pass scan agrees with repeated leftmost removal on adversarial input', () => {
	// The reference: rescan the whole payload after every removal. It is the
	// obvious implementation and quadratic, which is why it is not the shipped
	// one — this pins the fast path to its results.
	const reference = (text: string): string => {
		let body = text;
		while (body.includes(PASTE_END)) {
			body = body.replace(PASTE_END, '');
		}
		return `${PASTE_START}${body}${PASTE_END}`;
	};

	// Biased towards the pieces a marker is built from, so splices are common.
	const alphabet = [
		'\x1b',
		'[',
		'2',
		'0',
		'1',
		'~',
		'a',
		'\n',
		'\r',
		PASTE_END,
		PASTE_START,
		'\x1b[20',
		'1~',
		'\u{1f600}',
		'\ud800', // a lone surrogate must survive a code-unit scan
	];
	let seed = 12345;
	const next = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

	for (let i = 0; i < 20_000; i++) {
		let input = '';
		const pieces = 1 + Math.floor(next() * 14);
		for (let j = 0; j < pieces; j++) {
			input += alphabet[Math.floor(next() * alphabet.length)];
		}
		assert.equal(wrapBracketedPaste(input), reference(input), `input: ${JSON.stringify(input)}`);
	}
});

test('does not treat the escape sequence as a regular expression', () => {
	// PASTE_END contains '[', a regex metacharacter.
	assert.equal(wrapBracketedPaste('a[201~b'), `${PASTE_START}a[201~b${PASTE_END}`);
});

test('preserves newlines so a multi-comment payload arrives intact', () => {
	const payload = 'a.rs:1\n+x\none\n\nb.rs:2\n+y\ntwo';
	assert.equal(wrapBracketedPaste(payload), `${PASTE_START}${payload}${PASTE_END}`);
});

test('stripPasteMarkers and forLog round-trip for display', () => {
	assert.equal(stripPasteMarkers(wrapBracketedPaste('hi')), 'hi');
	assert.equal(forLog(`\x1b[31mred`), '<ESC>[31mred');
});

test('terminates a payload with a newline', () => {
	// Without it the next send continues on the same line as this one.
	assert.equal(withTrailingNewline('a.rs:1\n+x\nfix this'), 'a.rs:1\n+x\nfix this\n');
});

test('does not stack newlines on a payload that already ends with one', () => {
	assert.equal(withTrailingNewline('done\n'), 'done\n');
});

test('leaves interior blank lines alone', () => {
	// The blank line between two comment blocks is the block separator.
	assert.equal(withTrailingNewline('a.rs:1\none\n\nb.rs:2\ntwo'), 'a.rs:1\none\n\nb.rs:2\ntwo\n');
});

test('the newline belongs inside the paste markers', () => {
	// Outside them a terminal reads it as Enter, which would submit the review
	// instead of leaving it for the user to send.
	const wrapped = wrapBracketedPaste(withTrailingNewline('fix this'));
	assert.equal(wrapped, `${PASTE_START}fix this\n${PASTE_END}`);
	assert.equal(wrapped.endsWith(PASTE_END), true);
});
