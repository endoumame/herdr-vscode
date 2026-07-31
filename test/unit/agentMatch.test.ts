import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lacksCwdSupport, scoreAgents } from '../../src/target/agentMatch.js';
import type { HerdrAgent } from '../../src/herdr/types.js';

function agent(paneId: string, cwd?: string): HerdrAgent {
	return { agent: 'claude', paneId, stateLabels: [], ...(cwd === undefined ? {} : { cwd }) };
}

test('an exact cwd match outranks everything else', () => {
	const ranked = scoreAgents(
		[agent('1', '/home/me/other'), agent('2', '/home/me/repo')],
		['/home/me/repo'],
	);
	assert.equal(ranked[0]?.agent.paneId, '2');
	assert.equal(ranked[0]?.quality, 'exact');
	assert.equal(ranked[1]?.quality, 'none');
});

test('an agent inside a subdirectory of the repo still matches', () => {
	const ranked = scoreAgents([agent('1', '/home/me/repo/packages/app')], ['/home/me/repo']);
	assert.equal(ranked[0]?.quality, 'agent-under-root');
});

test('an agent at a parent directory matches more weakly', () => {
	const ranked = scoreAgents([agent('1', '/home/me')], ['/home/me/repo']);
	assert.equal(ranked[0]?.quality, 'root-under-agent');
});

test('a subdirectory match beats a parent match', () => {
	const ranked = scoreAgents(
		[agent('1', '/home/me'), agent('2', '/home/me/repo/src')],
		['/home/me/repo'],
	);
	assert.equal(ranked[0]?.agent.paneId, '2');
});

test('a sibling directory does not match on a shared prefix', () => {
	// '/home/me/repo-other' starts with '/home/me/repo' as a raw string.
	const ranked = scoreAgents([agent('1', '/home/me/repo-other')], ['/home/me/repo']);
	assert.equal(ranked[0]?.quality, 'none');
});

test('trailing slashes on either side are ignored', () => {
	const ranked = scoreAgents([agent('1', '/home/me/repo/')], ['/home/me/repo']);
	assert.equal(ranked[0]?.quality, 'exact');
});

test('an agent without a cwd never matches', () => {
	const ranked = scoreAgents([agent('1')], ['/home/me/repo']);
	assert.equal(ranked[0]?.quality, 'none');
});

test('the best root wins in a multi-root workspace', () => {
	const ranked = scoreAgents(
		[agent('1', '/home/me/second')],
		['/home/me/first', '/home/me/second'],
	);
	assert.equal(ranked[0]?.quality, 'exact');
	assert.equal(ranked[0]?.matchedRoot, '/home/me/second');
});

test('ranking is stable by pane id within a quality band', () => {
	const ranked = scoreAgents(
		[agent('b', '/home/me/repo'), agent('a', '/home/me/repo')],
		['/home/me/repo'],
	);
	assert.deepEqual(ranked.map(c => c.agent.paneId), ['a', 'b']);
});

test('detects a herdr build that predates cwd reporting', () => {
	assert.equal(lacksCwdSupport([agent('1'), agent('2')]), true);
	assert.equal(lacksCwdSupport([agent('1'), agent('2', '/x')]), false);
	assert.equal(lacksCwdSupport([]), false);
});
