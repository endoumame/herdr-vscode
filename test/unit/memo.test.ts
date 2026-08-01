import assert from 'node:assert/strict';
import { test } from 'node:test';

import { memoize, memoizeAsync, memoizeKeyed } from '../../src/util/memo.js';

test('memoize computes once and replays the same value', () => {
	let calls = 0;
	const value = memoize(() => {
		calls += 1;
		return { n: calls };
	});
	const first = value.get();
	assert.equal(value.get(), first, 'the identical object is replayed, not a copy');
	assert.equal(value.get(), first);
	assert.equal(calls, 1);
});

test('memoize recomputes exactly once after an invalidation', () => {
	let calls = 0;
	const value = memoize(() => ++calls);
	value.get();
	value.get();
	value.invalidate();
	assert.equal(value.get(), 2);
	value.get();
	assert.equal(calls, 2);
});

test('memoize caches a falsy value rather than recomputing it', () => {
	let calls = 0;
	const value = memoize(() => {
		calls += 1;
		return 0;
	});
	assert.equal(value.get(), 0);
	assert.equal(value.get(), 0);
	assert.equal(calls, 1);
});

test('memoize does not compute until the value is asked for', () => {
	let calls = 0;
	memoize(() => ++calls);
	assert.equal(calls, 0);
});

test('memoizeAsync collapses concurrent callers onto one computation', async () => {
	let calls = 0;
	const value = memoizeAsync(async () => {
		calls += 1;
		await Promise.resolve();
		return calls;
	});
	const [a, b, c] = await Promise.all([value.get(), value.get(), value.get()]);
	assert.deepEqual([a, b, c], [1, 1, 1]);
	assert.equal(calls, 1);
});

test('memoizeAsync does not cache a rejection', async () => {
	let calls = 0;
	const value = memoizeAsync(async () => {
		calls += 1;
		if (calls === 1) {
			throw new Error('transient');
		}
		return 'ok';
	});
	await assert.rejects(() => value.get(), /transient/);
	assert.equal(await value.get(), 'ok', 'a failure must not be memoised');
	assert.equal(calls, 2);
});

test('memoizeAsync recomputes after an invalidation', async () => {
	let calls = 0;
	const value = memoizeAsync(async () => ++calls);
	assert.equal(await value.get(), 1);
	value.invalidate();
	assert.equal(await value.get(), 2);
	assert.equal(await value.get(), 2);
});

test('memoizeKeyed computes once per key', async () => {
	let calls = 0;
	const value = memoizeKeyed(async (key: string) => {
		calls += 1;
		return key.toUpperCase();
	});
	assert.equal(await value.get('a'), 'A');
	assert.equal(await value.get('a'), 'A');
	assert.equal(await value.get('b'), 'B');
	assert.equal(calls, 2);
});

test('memoizeKeyed does not cache a rejected key', async () => {
	let calls = 0;
	const value = memoizeKeyed(async (key: string) => {
		calls += 1;
		if (calls === 1) {
			throw new Error('transient');
		}
		return key;
	});
	await assert.rejects(() => value.get('a'), /transient/);
	assert.equal(await value.get('a'), 'a');
});
