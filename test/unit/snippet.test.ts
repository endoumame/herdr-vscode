import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSnippet, snippetLinesToRead } from '../../src/review/snippet.js';

const OPTS = { snippetPrefix: 'auto' as const, snippetMaxLines: 40 };

test('auto prefixes + on the head side of a diff', () => {
	const out = buildSnippet(['a', 'b'], { kind: 'diff', isBaseSide: false }, OPTS);
	assert.deepEqual(out, ['+a', '+b']);
});

test('auto prefixes - on the base side of a diff', () => {
	const out = buildSnippet(['a'], { kind: 'diff', isBaseSide: true }, OPTS);
	assert.deepEqual(out, ['-a']);
});

test('auto leaves ordinary files unprefixed', () => {
	// A comment on a plain file is not a diff; a `+` would claim the line was added.
	const out = buildSnippet(['def f():', '    return 1'], { kind: 'file', isBaseSide: false }, OPTS);
	assert.deepEqual(out, ['def f():', '    return 1']);
});

test('diff mode turns a blank line into a bare prefix, never an empty element', () => {
	// An empty element would emit "\n\n" mid-block and split one comment in two.
	const out = buildSnippet(['a', '', 'b'], { kind: 'diff', isBaseSide: false }, OPTS);
	assert.deepEqual(out, ['+a', '+', '+b']);
	assert.equal(out.some(line => line.length === 0), false);
});

test('plain mode drops blank lines to preserve the same invariant', () => {
	const out = buildSnippet(['a', '', '   ', 'b'], { kind: 'file', isBaseSide: false }, OPTS);
	assert.deepEqual(out, ['a', 'b']);
});

test('trims trailing whitespace and carriage returns', () => {
	const out = buildSnippet(['a  \r', 'b\t'], { kind: 'file', isBaseSide: false }, OPTS);
	assert.deepEqual(out, ['a', 'b']);
});

test('truncates long selections with an elision marker', () => {
	const out = buildSnippet(['1', '2', '3', '4', '5'], { kind: 'diff', isBaseSide: false }, {
		snippetPrefix: 'auto',
		snippetMaxLines: 2,
	});
	assert.deepEqual(out, ['+1', '+2', '+... (3 more lines omitted)']);
});

test('the elision marker is singular for one omitted line', () => {
	const out = buildSnippet(['1', '2'], { kind: 'file', isBaseSide: false }, {
		snippetPrefix: 'none',
		snippetMaxLines: 1,
	});
	assert.deepEqual(out, ['1', '... (1 more line omitted)']);
});

test('snippetMaxLines of 0 disables snippets', () => {
	assert.deepEqual(
		buildSnippet(['a'], { kind: 'diff', isBaseSide: false }, { snippetPrefix: 'auto', snippetMaxLines: 0 }),
		[],
	);
});

test('diff mode forces prefixes even on an ordinary file', () => {
	const out = buildSnippet(['a'], { kind: 'file', isBaseSide: false }, {
		snippetPrefix: 'diff',
		snippetMaxLines: 40,
	});
	assert.deepEqual(out, ['+a']);
});

test('none mode strips prefixes even on a diff', () => {
	const out = buildSnippet(['a'], { kind: 'diff', isBaseSide: true }, {
		snippetPrefix: 'none',
		snippetMaxLines: 40,
	});
	assert.deepEqual(out, ['a']);
});

test('totalLines lets the caller pass only the lines that survive truncation', () => {
	// Reading a 100k-line selection to keep 2 lines of it is the waste this
	// avoids: the caller reads maxLines and reports how many there really were.
	const out = buildSnippet(['1', '2'], { kind: 'diff', isBaseSide: false }, {
		snippetPrefix: 'auto',
		snippetMaxLines: 2,
		totalLines: 5,
	});
	assert.deepEqual(out, ['+1', '+2', '+... (3 more lines omitted)']);
});

test('a pre-truncated read matches what the full read would have produced', () => {
	const all = ['1', '2', '3', '4', '5'];
	const opts = { snippetPrefix: 'auto' as const, snippetMaxLines: 3 };
	assert.deepEqual(
		buildSnippet(all.slice(0, 3), { kind: 'diff', isBaseSide: false }, { ...opts, totalLines: 5 }),
		buildSnippet(all, { kind: 'diff', isBaseSide: false }, opts),
	);
});

test('totalLines defaults to the number of lines handed in', () => {
	const out = buildSnippet(['1', '2', '3'], { kind: 'file', isBaseSide: false }, {
		snippetPrefix: 'none',
		snippetMaxLines: 2,
	});
	assert.deepEqual(out, ['1', '2', '... (1 more line omitted)']);
});

test('a totalLines at or below the cap adds no elision marker', () => {
	const out = buildSnippet(['1', '2'], { kind: 'file', isBaseSide: false }, {
		snippetPrefix: 'none',
		snippetMaxLines: 2,
		totalLines: 2,
	});
	assert.deepEqual(out, ['1', '2']);
});

test('blank lines are dropped after truncation, not before', () => {
	// Order matters: filtering first would pull later lines under the cap and
	// change both the kept lines and the omitted count.
	const out = buildSnippet(['a', '', 'b', 'c'], { kind: 'file', isBaseSide: false }, {
		snippetPrefix: 'none',
		snippetMaxLines: 3,
	});
	assert.deepEqual(out, ['a', 'b', '... (1 more line omitted)']);
});

test('snippetLinesToRead reports how many lines are worth reading', () => {
	// 0 disables snippets entirely, so the document need not be opened at all.
	assert.equal(snippetLinesToRead({ snippetMaxLines: 0 }), 0);
	assert.equal(snippetLinesToRead({ snippetMaxLines: 40 }), 40);
	assert.equal(snippetLinesToRead({ snippetMaxLines: -1 }), 0);
});
