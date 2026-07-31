import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	exportComments,
	exportWithPreamble,
	formatComment,
	formatLocation,
	normalizeText,
	type ExportableComment,
} from '../../src/review/export.js';

function comment(
	path: string,
	startLine: number,
	endLine: number,
	snippet: string[],
	text: string,
	isBaseSide = false,
): ExportableComment {
	return { location: { path, startLine, endLine, isBaseSide }, snippet, text };
}

test('matches the reviewr README example byte for byte', () => {
	const out = formatComment(
		comment(
			'extruct/core/llm_registry.py',
			40,
			41,
			['-from .z import w', '+from .x import y'],
			'this import path looks wrong',
		),
	);
	assert.equal(
		out,
		'extruct/core/llm_registry.py:40-41\n' +
			'-from .z import w\n' +
			'+from .x import y\n' +
			'this import path looks wrong',
	);
});

test('formats single-line, multi-line and removed locations', () => {
	assert.equal(formatLocation({ path: 'file.rs', startLine: 3, endLine: 3, isBaseSide: false }), 'file.rs:3');
	assert.equal(formatLocation({ path: 'a.rs', startLine: 1, endLine: 9, isBaseSide: false }), 'a.rs:1-9');
	assert.equal(formatLocation({ path: 'a.rs', startLine: 38, endLine: 38, isBaseSide: true }), 'a.rs:38 (removed)');
	assert.equal(formatLocation({ path: 'a.rs', startLine: 2, endLine: 4, isBaseSide: true }), 'a.rs:2-4 (removed)');
});

test("reproduces reviewr's sort-by-file-then-start with blank separators", () => {
	const out = exportComments([
		comment('a.rs', 20, 20, ['+y'], 'later'),
		comment('b.rs', 5, 5, ['+x'], 'two'),
		comment('a.rs', 3, 3, ['+z'], 'earlier'),
	]);
	assert.equal(out, ['a.rs:3\n+z\nearlier', 'a.rs:20\n+y\nlater', 'b.rs:5\n+x\ntwo'].join('\n\n'));
});

test('sorts paths in byte order, not ICU collation order', () => {
	// 'B.rs'.localeCompare('a.rs') is 1 under ICU but 'B' < 'a' in byte order.
	assert.equal('B.rs'.localeCompare('a.rs') > 0, true, 'precondition: ICU disagrees with bytes');
	const out = exportComments([comment('a.rs', 1, 1, ['+x'], 'lower'), comment('B.rs', 1, 1, ['+y'], 'upper')]);
	assert.equal(out.startsWith('B.rs:1'), true);
});

test('normalizeText strips CRs, trailing whitespace and blank lines', () => {
	assert.equal(normalizeText('a\r\n\r\n  \nb   \n\t\n c'), 'a\nb\n c');
});

test('a blank line inside a comment body cannot forge a block separator', () => {
	const out = exportComments([comment('a.rs', 1, 1, ['+x'], 'first\n\nsecond')]);
	assert.equal(out.split('\n\n').length, 1);
	assert.equal(out, 'a.rs:1\n+x\nfirst\nsecond');
});

test('an empty snippet falls back to the two-part form', () => {
	// The three-part form would emit `head\n\nbody`, splitting the block.
	const out = formatComment(comment('a.rs', 7, 7, [], 'no snippet available'));
	assert.equal(out, 'a.rs:7\nno snippet available');
	assert.equal(out.includes('\n\n'), false);
});

test('emits no trailing newline and no header or footer', () => {
	const out = exportComments([comment('a.rs', 1, 1, ['+x'], 'one')]);
	assert.equal(out.endsWith('\n'), false);
	assert.equal(out.startsWith('a.rs:1'), true);
});

test('an empty queue exports to an empty string', () => {
	assert.equal(exportComments([]), '');
});

test('the preamble defaults to nothing and is separated by a blank line when set', () => {
	const items = [comment('a.rs', 1, 1, ['+x'], 'one')];
	assert.equal(exportWithPreamble(items, ''), 'a.rs:1\n+x\none');
	assert.equal(exportWithPreamble(items, 'Please fix:'), 'Please fix:\n\na.rs:1\n+x\none');
});
