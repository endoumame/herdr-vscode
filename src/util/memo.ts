/**
 * Small memoisation primitives.
 *
 * Everything the extension memoises is either a settings snapshot or an
 * environment probe, so each one needs the same two properties: compute at most
 * once, and be explicitly invalidatable when the thing behind it changes. A
 * failure is never cached — a transient `fs.realpath` error or a herdr binary
 * that is still being installed must not poison the rest of the session.
 */

export interface Memo<T> {
	get(): T;
	invalidate(): void;
}

export interface AsyncMemo<T> {
	get(): Promise<T>;
	invalidate(): void;
}

export interface KeyedMemo<K, V> {
	get(key: K): Promise<V>;
	invalidate(): void;
}

/**
 * A lazily computed value. `undefined` is tracked with a separate flag so a
 * falsy or absent result is still only computed once.
 */
export function memoize<T>(compute: () => T): Memo<T> {
	let value: T;
	let computed = false;
	return {
		get(): T {
			if (!computed) {
				value = compute();
				computed = true;
			}
			return value;
		},
		invalidate(): void {
			computed = false;
			value = undefined as T;
		},
	};
}

/**
 * The promise itself is cached, so concurrent callers share one in-flight
 * computation rather than racing to start their own.
 */
export function memoizeAsync<T>(compute: () => Promise<T>): AsyncMemo<T> {
	let pending: Promise<T> | undefined;
	return {
		get(): Promise<T> {
			if (!pending) {
				const started = compute().catch((err: unknown) => {
					if (pending === started) {
						pending = undefined; // let the next caller retry
					}
					throw err;
				});
				pending = started;
			}
			return pending;
		},
		invalidate(): void {
			pending = undefined;
		},
	};
}

/** The same contract, per key. Used for path lookups that never change. */
export function memoizeKeyed<K, V>(compute: (key: K) => Promise<V>): KeyedMemo<K, V> {
	const entries = new Map<K, Promise<V>>();
	return {
		get(key: K): Promise<V> {
			const existing = entries.get(key);
			if (existing) {
				return existing;
			}
			const started = compute(key).catch((err: unknown) => {
				if (entries.get(key) === started) {
					entries.delete(key);
				}
				throw err;
			});
			entries.set(key, started);
			return started;
		},
		invalidate(): void {
			entries.clear();
		},
	};
}
