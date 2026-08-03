import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

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

test('Escape stays with VS Code', () => {
	// `workbench.action.hideComment` reaches the widget the user is actually in
	// and collapses it in the workbench, deleting the thread when it holds no
	// comments. A contributed binding is registered at `ExternalExtension`
	// weight, above the `EditorContrib` weight of that rule, so binding Escape
	// here does not run alongside it — it replaces it with a handler that gets
	// no argument and can only guess which thread to close.
	for (const binding of keybindings) {
		for (const key of [binding.key, binding.mac ?? '']) {
			assert.ok(!/\bescape\b/.test(key), `${binding.command} shadows ${key}`);
		}
	}
});

test('nothing shadows VS Code’s own keys inside a comment editor', () => {
	// `editor.action.submitComment` is the only thing that can hand a comment
	// command the text being typed, and `workbench.action.hideComment` the only
	// thing that can close the widget holding it. An extension binding on
	// either key wins on weight and arrives with no arguments at all.
	for (const binding of keybindings) {
		if (!/\bcommentEditorFocused\b/.test(binding.when ?? '')) {
			continue;
		}
		for (const key of [binding.key, binding.mac ?? '']) {
			assert.ok(!/\b(enter|escape)\b/.test(key), `${binding.command} shadows ${key}`);
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
