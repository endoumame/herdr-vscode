import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSnippet } from '../../src/review/snippet.js';

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
