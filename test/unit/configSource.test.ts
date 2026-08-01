import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	createConfigReader,
	readHerdrConfig,
	type ConfigSource,
} from '../../src/configSource.js';

/** Stands in for a `vscode.WorkspaceConfiguration`, counting every read. */
function source(overrides: Record<string, unknown> = {}) {
	const reads: string[] = [];
	const src: ConfigSource = {
		get<T>(key: string, defaultValue: T): T {
			reads.push(key);
			return key in overrides ? (overrides[key] as T) : defaultValue;
		},
	};
	return { src, reads };
}

test('reads every setting off the source with the packaged defaults', () => {
	const { src } = source();
	const cfg = readHerdrConfig(src);
	assert.equal(cfg.binPath, '');
	assert.equal(cfg.session, '');
	assert.equal(cfg.socketPath, '');
	assert.deepEqual(cfg.extraArgs, []);
	assert.equal(cfg.commandTimeoutMs, 10000);
	assert.equal(cfg.bracketedPaste, 'always');
	assert.equal(cfg.focusAgentAfterSend, true);
	assert.equal(cfg.snippetMaxLines, 40);
	assert.equal(cfg.snippetPrefix, 'auto');
	assert.equal(cfg.agentMatchStrategy, 'cwd');
	assert.equal(cfg.showStatusBar, true);
	assert.equal(cfg.clearThreadsAfterSend, true);
	assert.equal(cfg.preamble, '');
});

test('configured values come through', () => {
	const { src } = source({
		binPath: '/opt/herdr',
		snippetMaxLines: 5,
		snippetPrefix: 'diff',
		showStatusBar: false,
		extraArgs: ['--verbose'],
	});
	const cfg = readHerdrConfig(src);
	assert.equal(cfg.binPath, '/opt/herdr');
	assert.equal(cfg.snippetMaxLines, 5);
	assert.equal(cfg.snippetPrefix, 'diff');
	assert.equal(cfg.showStatusBar, false);
	assert.deepEqual(cfg.extraArgs, ['--verbose']);
});

test('commentingSchemes is a set, so the gutter check is not a linear scan', () => {
	const { src } = source({ commentingSchemes: ['file', 'pr', 'file'] });
	const cfg = readHerdrConfig(src);
	assert.equal(cfg.commentingSchemes.has('file'), true);
	assert.equal(cfg.commentingSchemes.has('pr'), true);
	assert.equal(cfg.commentingSchemes.has('vscode-vfs'), false);
	assert.equal(cfg.commentingSchemes.size, 2);
});

test('a missing commentingSchemes array yields an empty set rather than throwing', () => {
	const { src } = source({ commentingSchemes: undefined });
	assert.equal(readHerdrConfig(src).commentingSchemes.size, 0);
});

test('the reader opens the source and reads each key exactly once', () => {
	let opened = 0;
	const { src, reads } = source();
	const reader = createConfigReader(() => {
		opened += 1;
		return src;
	});
	reader.get();
	reader.get();
	reader.get();
	assert.equal(opened, 1);
	assert.equal(new Set(reads).size, reads.length, 'no key is read twice');
	assert.equal(reads.length > 0, true);
});

test('the reader hands back the identical snapshot, so downstream caches can key on it', () => {
	const { src } = source();
	const reader = createConfigReader(() => src);
	assert.equal(reader.get(), reader.get());
});

test('invalidation re-opens the source, because a WorkspaceConfiguration is a snapshot', () => {
	let opened = 0;
	let binPath = '/one';
	const reader = createConfigReader(() => {
		opened += 1;
		const value = binPath;
		return { get: <T,>(key: string, defaultValue: T): T => (key === 'binPath' ? (value as T) : defaultValue) };
	});
	assert.equal(reader.get().binPath, '/one');
	binPath = '/two';
	assert.equal(reader.get().binPath, '/one', 'still cached');
	reader.invalidate();
	assert.equal(reader.get().binPath, '/two');
	assert.equal(opened, 2);
});

test('the reader does not touch the source until the first get', () => {
	let opened = 0;
	createConfigReader(() => {
		opened += 1;
		return source().src;
	});
	assert.equal(opened, 0);
});
