import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractCliMessage } from '../../src/herdr/errors.js';
import { parseAgentList } from '../../src/herdr/types.js';

test('pulls the message out of a JSON diagnostic', () => {
	assert.equal(extractCliMessage('{"error":"no such pane"}'), 'no such pane');
	assert.equal(extractCliMessage('{"message":"boom"}'), 'boom');
	assert.equal(extractCliMessage('{"error":{"message":"nested"}}'), 'nested');
});

test('prefers the last JSON line when several are emitted', () => {
	const stderr = '{"message":"first"}\n{"message":"second"}';
	assert.equal(extractCliMessage(stderr), 'second');
});

test('falls back to raw text so a plain panic is not swallowed', () => {
	assert.equal(extractCliMessage('thread panicked at src/main.rs'), 'thread panicked at src/main.rs');
	assert.equal(extractCliMessage('   '), '');
});

test('skips unparseable lines and keeps looking', () => {
	assert.equal(extractCliMessage('{"message":"good"}\n{broken'), 'good');
});

test('parses the agent list envelope', () => {
	const agents = parseAgentList(
		JSON.stringify({
			result: {
				agents: [
					{
						agent: 'claude',
						agent_status: 'idle',
						pane_id: '1-2',
						tab_id: '1',
						workspace_id: 'w',
						cwd: '/home/me/repo',
						display_agent: 'Claude Code',
					},
				],
			},
		}),
	);
	assert.equal(agents.length, 1);
	assert.equal(agents[0]?.paneId, '1-2');
	assert.equal(agents[0]?.cwd, '/home/me/repo');
	assert.equal(agents[0]?.displayAgent, 'Claude Code');
});

test('drops panes that are not agents', () => {
	const agents = parseAgentList(
		JSON.stringify({ result: { agents: [{ agent: null, pane_id: '1' }, { agent: 'codex', pane_id: '2' }] } }),
	);
	assert.deepEqual(agents.map(a => a.paneId), ['2']);
});

test('coerces a numeric pane id, since it is used as a CLI argument', () => {
	const agents = parseAgentList(
		JSON.stringify({ result: { agents: [{ agent: 'claude', pane_id: 12 }] } }),
	);
	assert.equal(agents[0]?.paneId, '12');
});

test('accepts state_labels as either a map or an array', () => {
	const asMap = parseAgentList(
		JSON.stringify({ result: { agents: [{ agent: 'a', pane_id: '1', state_labels: { k: 'busy' } }] } }),
	);
	const asArray = parseAgentList(
		JSON.stringify({ result: { agents: [{ agent: 'a', pane_id: '1', state_labels: ['busy'] }] } }),
	);
	assert.deepEqual(asMap[0]?.stateLabels, ['busy']);
	assert.deepEqual(asArray[0]?.stateLabels, ['busy']);
});

test('omits absent optional fields rather than storing empty strings', () => {
	const agents = parseAgentList(
		JSON.stringify({ result: { agents: [{ agent: 'a', pane_id: '1', cwd: '' }] } }),
	);
	assert.equal(agents[0]?.cwd, undefined);
});

test('rejects output that is not the expected envelope', () => {
	assert.throws(() => parseAgentList('not json'), /did not return JSON/);
	assert.throws(() => parseAgentList('{"result":{}}'), /missing result\.agents/);
});
