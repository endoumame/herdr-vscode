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
