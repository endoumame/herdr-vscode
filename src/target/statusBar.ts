import * as vscode from 'vscode';

import { getConfig, invalidateConfig } from '../config.js';
import type { CommentQueue } from '../review/queue.js';
import { label, type TargetStore } from './targetStore.js';

/** What the status bar should look like, or `undefined` when it is hidden. */
interface Rendering {
	text: string;
	tooltip: string;
	markdown: boolean;
	command: string;
}

export class TargetStatusBar implements vscode.Disposable {
	private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	private readonly disposables: vscode.Disposable[] = [];
	private binaryMissing = false;
	private lastQueueNotEmpty: boolean | undefined;
	private rendered: Rendering | undefined;
	private everRendered = false;

	constructor(
		private readonly store: TargetStore,
		private readonly queue: CommentQueue,
	) {
		this.disposables.push(
			this.item,
			this.store.onDidChange(() => this.refresh()),
			this.queue.onDidChange(() => this.refresh()),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('herdr.showStatusBar')) {
					// Dispatch order against the shared config watcher is not
					// something to rely on; invalidating again is idempotent.
					invalidateConfig();
					this.refresh();
				}
			}),
		);
		this.refresh();
	}

	setBinaryMissing(missing: boolean): void {
		this.binaryMissing = missing;
		this.refresh();
	}

	/**
	 * Called on every queue mutation, so it is written to do nothing when
	 * nothing it renders has changed. Both writes it guards are more expensive
	 * than they look: `setContext` round-trips to the workbench and invalidates
	 * every `when` clause, and each `StatusBarItem` property assignment queues a
	 * status bar re-render.
	 */
	refresh(): void {
		const count = this.queue.size;
		const notEmpty = count > 0;
		if (this.lastQueueNotEmpty !== notEmpty) {
			this.lastQueueNotEmpty = notEmpty;
			void vscode.commands.executeCommand('setContext', 'herdr.queueNotEmpty', notEmpty);
		}

		this.render(this.describe(count));
	}

	private describe(count: number): Rendering | undefined {
		if (!getConfig().showStatusBar) {
			return undefined;
		}

		if (this.binaryMissing) {
			return {
				text: '$(warning) herdr: not found',
				tooltip: 'The herdr binary could not be located. Click to see the log.',
				markdown: false,
				command: 'herdr.showLog',
			};
		}

		const target = this.store.current;
		const name = target ? label(target) : undefined;
		const badge = count > 0 ? ` $(comment-discussion) ${count}` : '';

		let tooltip = '';
		if (target) {
			tooltip += `**Agent:** ${name}\n\n`;
			if (target.cwd) {
				tooltip += `**Working directory:** \`${target.cwd}\`\n\n`;
			}
			tooltip += `**Pane:** \`${target.paneId}\`\n\n`;
		} else {
			tooltip += 'No target agent selected.\n\n';
		}
		tooltip +=
			count > 0
				? `${count} comment${count === 1 ? '' : 's'} queued — click to send.`
				: 'Click to select a herdr agent.';

		return {
			text: `$(hubot) herdr: ${name ?? 'none'}${badge}`,
			tooltip,
			markdown: true,
			command: count > 0 ? 'herdr.sendAll' : 'herdr.pickAgent',
		};
	}

	private render(next: Rendering | undefined): void {
		// An unchanged status bar costs three string comparisons rather than
		// three property writes and a MarkdownString.
		if (this.everRendered && same(this.rendered, next)) {
			return;
		}
		this.rendered = next;
		this.everRendered = true;

		if (!next) {
			this.item.hide();
			return;
		}
		this.item.text = next.text;
		this.item.tooltip = next.markdown ? new vscode.MarkdownString(next.tooltip) : next.tooltip;
		this.item.command = next.command;
		this.item.show();
	}

	dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
	}
}

function same(a: Rendering | undefined, b: Rendering | undefined): boolean {
	if (a === undefined || b === undefined) {
		return a === b;
	}
	return (
		a.command === b.command &&
		a.markdown === b.markdown &&
		a.text === b.text &&
		a.tooltip === b.tooltip
	);
}
