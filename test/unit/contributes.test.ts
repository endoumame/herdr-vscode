import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
	THREAD_CONTEXT_PATTERN,
	THREAD_MULTI,
	THREAD_SINGLE,
} from '../../src/review/threadContext.js';

/**
 * The comment widget is VS Code's, not ours, and most of what it does on the
 * keyboard is decided in `package.json` rather than in code. These check the
 * two rules that are easy to break from there.
 */

interface Keybinding {
	command: string;
	key: string;
	mac?: string;
	when?: string;
}

interface MenuItem {
	command: string;
	group?: string;
	when?: string;
}

interface Contributes {
	commands: { command: string }[];
	keybindings: Keybinding[];
	menus: Record<string, MenuItem[]>;
}

const pkg = JSON.parse(
	readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
) as { contributes: Contributes };

const { commands, keybindings, menus } = pkg.contributes;

/** The action VS Code runs first, which is the one its own keybindings hit. */
function firstAction(menuId: string): string {
	const items = menus[menuId];
	assert.ok(items && items.length > 0, `${menuId} has no items`);
	const ordered = [...items].sort((a, b) => {
		const [aGroup = '', aOrder = ''] = (a.group ?? '').split('@');
		const [bGroup = '', bOrder = ''] = (b.group ?? '').split('@');
		return aGroup.localeCompare(bGroup) || Number(aOrder) - Number(bOrder);
	});
	return ordered[0]!.command;
}

test('every contributed keybinding names a declared command', () => {
	const declared = new Set(commands.map(c => c.command));
	for (const binding of keybindings) {
		assert.ok(declared.has(binding.command), `${binding.command} is not declared`);
	}
});

test('Escape only reaches this extension on a thread it owns', () => {
	const escape = keybindings.filter(b => b.key === 'escape');
	assert.equal(escape.length, 1);
	const when = escape[0]!.when ?? '';

	// Without the comment editor holding focus, Escape belongs to whatever else
	// the user is doing.
	assert.match(when, /\bcommentEditorFocused\b/);
	assert.match(when, /\bcommentController == herdr\.review\b/);

	// A thread this extension never created — the widget behind the gutter `+`
	// — has no contextValue, and its Escape has to stay with VS Code, which is
	// the only side that can close it.
	const clause = /commentThread =~ \/(.+?)\//.exec(when);
	assert.ok(clause, `no commentThread pattern in ${when}`);
	const pattern = new RegExp(clause[1]!);
	assert.equal(pattern.source, new RegExp(THREAD_CONTEXT_PATTERN).source);
	assert.ok(pattern.test(THREAD_SINGLE));
	assert.ok(pattern.test(THREAD_MULTI));
	assert.ok(!pattern.test(''));
	assert.ok(!pattern.test('github.pr.thread'));
});

test('nothing shadows VS Code’s Ctrl+Enter inside a comment editor', () => {
	// `editor.action.submitComment` is the only thing that can hand a comment
	// command the text being typed; an extension binding on the same key wins
	// on weight and arrives with no arguments at all.
	for (const binding of keybindings) {
		if (!/\bcommentEditorFocused\b/.test(binding.when ?? '')) {
			continue;
		}
		for (const key of [binding.key, binding.mac ?? '']) {
			assert.ok(!/\benter\b/.test(key), `${binding.command} shadows ${key}`);
		}
	}
});

test('Ctrl+Enter queues a new comment rather than sending the queue', () => {
	// VS Code runs the first action of the widget's menu, so ordering here is
	// what decides the shortcut.
	assert.equal(firstAction('comments/commentThread/context'), 'herdr.createComment');
});

test('Ctrl+Enter keeps an edit rather than discarding it', () => {
	assert.equal(firstAction('comments/comment/context'), 'herdr.saveComment');
});
