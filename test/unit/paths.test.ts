import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import {
	dedupeRealpaths,
	expandHome,
	invalidateRealpathCache,
	realpathOrSelf,
} from '../../src/util/paths.js';

test('expandHome resolves a bare tilde and a tilde prefix', () => {
	assert.equal(expandHome('~'), os.homedir());
	assert.equal(expandHome('~/bin/herdr'), path.join(os.homedir(), 'bin/herdr'));
	assert.equal(expandHome('/usr/bin/herdr'), '/usr/bin/herdr');
	assert.equal(expandHome('~notme/bin'), '~notme/bin');
});

test('realpathOrSelf falls back to the input for a path that does not exist', async () => {
	invalidateRealpathCache();
	const missing = path.join(os.tmpdir(), 'herdr-does-not-exist-1a2b3c');
	assert.equal(await realpathOrSelf(missing), missing);
});

test('realpathOrSelf resolves a symlink, and does it once per path', async () => {
	invalidateRealpathCache();
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'herdr-realpath-'));
	const target = path.join(dir, 'real');
	const link = path.join(dir, 'link');
	await fs.mkdir(target);
	await fs.symlink(target, link);

	const resolved = await realpathOrSelf(link);
	assert.equal(resolved, await fs.realpath(target));

	// The second lookup is served from the cache: the link is replaced with one
	// pointing elsewhere and the answer must not change.
	const other = path.join(dir, 'other');
	await fs.mkdir(other);
	await fs.unlink(link);
	await fs.symlink(other, link);
	assert.equal(await realpathOrSelf(link), resolved, 'a second lookup must not hit the disk');

	invalidateRealpathCache();
	assert.equal(await realpathOrSelf(link), await fs.realpath(other));

	await fs.rm(dir, { recursive: true, force: true });
});

test('a failed realpath is not cached, so a later attempt can still succeed', async () => {
	invalidateRealpathCache();
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'herdr-realpath-'));
	const later = path.join(dir, 'appears-later');

	assert.equal(await realpathOrSelf(later), later);
	await fs.mkdir(later);
	assert.equal(await realpathOrSelf(later), await fs.realpath(later));

	await fs.rm(dir, { recursive: true, force: true });
});

test('dedupeRealpaths keeps both the literal and the resolved path, without duplicates', async () => {
	invalidateRealpathCache();
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'herdr-dedupe-'));
	const target = path.join(dir, 'real');
	const link = path.join(dir, 'link');
	await fs.mkdir(target);
	await fs.symlink(target, link);

	const out = await dedupeRealpaths([link, link, target]);
	assert.equal(out.includes(link), true, 'the literal path is kept');
	assert.equal(out.includes(await fs.realpath(target)), true, 'the resolved path is kept');
	assert.equal(new Set(out).size, out.length, 'no duplicates');

	await fs.rm(dir, { recursive: true, force: true });
});

test('dedupeRealpaths preserves first-seen order', async () => {
	invalidateRealpathCache();
	const a = path.join(os.tmpdir(), 'herdr-order-a');
	const b = path.join(os.tmpdir(), 'herdr-order-b');
	assert.deepEqual(await dedupeRealpaths([a, b]), [a, b]);
});

test('dedupeRealpaths on an empty list does no work', async () => {
	assert.deepEqual(await dedupeRealpaths([]), []);
});
