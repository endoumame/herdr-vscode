import assert from 'node:assert/strict';
import { test } from 'node:test';

import { firstNonBlankLine, normalizeLine, rtrim, stripCr, toPosix } from '../../src/util/text.js';

test('stripCr removes every carriage return, not just a trailing one', () => {
	assert.equal(stripCr('a\rb\r'), 'ab');
	assert.equal(stripCr('\r\r'), '');
});

test('stripCr returns the identical string when there is nothing to strip', () => {
	const input = 'no carriage returns here';
	assert.equal(stripCr(input), input);
});

test('rtrim removes trailing spaces and tabs only', () => {
	assert.equal(rtrim('a  \t '), 'a');
	assert.equal(rtrim('  a'), '  a');
	assert.equal(rtrim('a b '), 'a b');
	assert.equal(rtrim('   '), '');
	assert.equal(rtrim(''), '');
});

test('rtrim leaves other whitespace alone, matching /[ \\t]+$/', () => {
	// A form feed or non-breaking space is not stripped by the original regex.
	assert.equal(rtrim('a\f'), 'a\f');
	assert.equal(rtrim('a\u00a0'), 'a\u00a0');
});

test('normalizeLine is stripCr followed by rtrim', () => {
	assert.equal(normalizeLine('a\r  '), 'a');
	assert.equal(normalizeLine('a\rb  \t'), 'ab');
	assert.equal(normalizeLine('  \r  '), '');
});

test('normalizeLine returns the identical string for an already-clean line', () => {
	const input = '  indented code';
	assert.equal(normalizeLine(input), input);
});

test('toPosix converts Windows separators', () => {
	assert.equal(toPosix('a\\b\\c.ts'), 'a/b/c.ts');
	assert.equal(toPosix('C:\\repo\\src'), 'C:/repo/src');
});

test('toPosix returns the identical string when there is no backslash', () => {
	const input = '/home/me/repo/src/a.ts';
	assert.equal(toPosix(input), input);
});

test('firstNonBlankLine skips leading blank lines', () => {
	assert.equal(firstNonBlankLine('\n\n  \nreal content\nmore', 60), 'real content');
	assert.equal(firstNonBlankLine('first\nsecond', 60), 'first');
});

test('firstNonBlankLine keeps the leading indentation of the line it picks', () => {
	assert.equal(firstNonBlankLine('\n    indented', 60), '    indented');
});

test('firstNonBlankLine falls back to the whole text when every line is blank', () => {
	assert.equal(firstNonBlankLine('', 60), '');
	assert.equal(firstNonBlankLine('   ', 60), '   ');
	assert.equal(firstNonBlankLine('\n\n', 60), '\n\n');
});

test('firstNonBlankLine elides past the limit', () => {
	assert.equal(firstNonBlankLine('x'.repeat(61), 60), `${'x'.repeat(60)}…`);
	assert.equal(firstNonBlankLine('x'.repeat(60), 60), 'x'.repeat(60));
});

test('firstNonBlankLine does not scan past what it needs', () => {
	// The tree label shows 60 characters; splitting a large body to find them
	// would allocate the whole thing line by line.
	const body = `${'a'.repeat(100)}\n${'b'.repeat(5_000_000)}`;
	const started = process.hrtime.bigint();
	const out = firstNonBlankLine(body, 60);
	const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
	assert.equal(out, `${'a'.repeat(60)}…`);
	assert.equal(elapsedMs < 50, true, `firstNonBlankLine took ${elapsedMs.toFixed(1)}ms`);
});
