import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveLocation, type UriLike } from '../../src/review/location.js';

function uri(scheme: string, path: string, query: unknown = undefined): UriLike {
	return { scheme, path, query: query === undefined ? '' : JSON.stringify(query) };
}

const ROOTS = ['/home/me/repo'];

function resolve(u: UriLike, startLine = 0, endLine = 0) {
	return resolveLocation(u, { startLine, endLine, roots: ROOTS });
}

test('converts 0-based document lines to 1-based inclusive line numbers', () => {
	const loc = resolve(uri('file', '/home/me/repo/src/a.ts'), 39, 40);
	assert.equal(loc?.startLine, 40);
	assert.equal(loc?.endLine, 41);
});

test('normalises an inverted range', () => {
	const loc = resolve(uri('file', '/home/me/repo/src/a.ts'), 10, 4);
	assert.deepEqual([loc?.startLine, loc?.endLine], [5, 11]);
});

test('file: is relativised against the repository root', () => {
	const loc = resolve(uri('file', '/home/me/repo/src/a.ts'));
	assert.equal(loc?.path, 'src/a.ts');
	assert.equal(loc?.kind, 'file');
	assert.equal(loc?.isBaseSide, false);
});

test('file: outside every root keeps its absolute path rather than emitting ..', () => {
	const loc = resolve(uri('file', '/elsewhere/x.ts'));
	assert.equal(loc?.path, '/elsewhere/x.ts');
	assert.equal(loc?.path.startsWith('..'), false);
});

test('review: uses rootPath and the base flag', () => {
	const loc = resolve(
		uri('review', '/home/me/repo/src/a.ts', {
			path: '/home/me/repo/src/a.ts',
			base: true,
			isOutdated: false,
			rootPath: '/home/me/repo',
		}),
	);
	assert.equal(loc?.path, 'src/a.ts');
	assert.equal(loc?.isBaseSide, true);
	assert.equal(loc?.kind, 'diff');
});

test('pr: uses fileName and isBase', () => {
	const loc = resolve(
		uri('pr', '/a.ts', { fileName: 'src/a.ts', isBase: false, prNumber: 7, baseCommit: 'x', headCommit: 'y' }),
	);
	assert.equal(loc?.path, 'src/a.ts');
	assert.equal(loc?.isBaseSide, false);
	assert.equal(loc?.kind, 'diff');
});

test('pr: on the base side of a rename uses the previous file name', () => {
	const loc = resolve(
		uri('pr', '/new.ts', { fileName: 'src/new.ts', previousFileName: 'src/old.ts', isBase: true }),
	);
	assert.equal(loc?.path, 'src/old.ts');
	assert.equal(loc?.isBaseSide, true);
});

test('pr: on the head side of a rename keeps the new file name', () => {
	const loc = resolve(
		uri('pr', '/new.ts', { fileName: 'src/new.ts', previousFileName: 'src/old.ts', isBase: false }),
	);
	assert.equal(loc?.path, 'src/new.ts');
});

test('githubpr: with isEmpty has nothing to comment on', () => {
	assert.equal(resolve(uri('githubpr', '/a.ts', { fileName: 'src/a.ts', isEmpty: true })), null);
});

test('githubcommit: takes the path off the URI', () => {
	const loc = resolve(uri('githubcommit', '/src/a.ts', { commit: 'abc', owner: 'o', repo: 'r' }));
	assert.equal(loc?.path, 'src/a.ts');
	assert.equal(loc?.kind, 'commit');
});

test('git: treats a non-empty ref as the base side', () => {
	const head = resolve(uri('git', '/home/me/repo/a.ts', { path: '/home/me/repo/a.ts', ref: '' }));
	const base = resolve(uri('git', '/home/me/repo/a.ts', { path: '/home/me/repo/a.ts', ref: 'HEAD' }));
	assert.equal(head?.isBaseSide, false);
	assert.equal(base?.isBaseSide, true);
});

test('vscode-vfs: drops the owner/repo prefix', () => {
	const loc = resolve(uri('vscode-vfs', '/octocat/hello/src/a.ts'));
	assert.equal(loc?.path, 'src/a.ts');
});

test('a malformed query degrades instead of throwing', () => {
	const loc = resolveLocation(
		{ scheme: 'pr', path: '/src/a.ts', query: '{not json' },
		{ startLine: 0, endLine: 0, roots: ROOTS },
	);
	assert.equal(loc?.path, 'src/a.ts');
	assert.equal(loc?.isBaseSide, false);
});

test('an unknown scheme is reported once and still resolves', () => {
	const seen: string[] = [];
	const loc = resolveLocation(
		{ scheme: 'made-up', path: '/home/me/repo/src/a.ts', query: '' },
		{ startLine: 0, endLine: 0, roots: ROOTS, onUnknownScheme: s => seen.push(s) },
	);
	assert.deepEqual(seen, ['made-up']);
	assert.equal(loc?.path, 'src/a.ts');
	assert.equal(loc?.kind, 'unknown');
});

test('the longest matching root wins in a nested workspace', () => {
	const loc = resolveLocation(
		{ scheme: 'file', path: '/home/me/repo/packages/app/a.ts', query: '' },
		{ startLine: 0, endLine: 0, roots: ['/home/me/repo', '/home/me/repo/packages/app'] },
	);
	assert.equal(loc?.path, 'a.ts');
});
