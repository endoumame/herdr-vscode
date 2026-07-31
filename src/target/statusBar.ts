import * as vscode from 'vscode';

import { getConfig } from '../config.js';
import type { CommentQueue } from '../review/queue.js';
import { label, type TargetStore } from './targetStore.js';

export class TargetStatusBar implements vscode.Disposable {
	private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	private readonly disposables: vscode.Disposable[] = [];
	private binaryMissing = false;

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

	refresh(): void {
		const count = this.queue.size;
		void vscode.commands.executeCommand('setContext', 'herdr.queueNotEmpty', count > 0);

		if (!getConfig().showStatusBar) {
			this.item.hide();
			return;
		}

		if (this.binaryMissing) {
			this.item.text = '$(warning) herdr: not found';
			this.item.tooltip = 'The herdr binary could not be located. Click to see the log.';
			this.item.command = 'herdr.showLog';
			this.item.show();
			return;
		}

		const target = this.store.current;
		const name = target ? label(target) : undefined;
		const badge = count > 0 ? ` $(comment-discussion) ${count}` : '';
		this.item.text = `$(hubot) herdr: ${name ?? 'none'}${badge}`;

		const tooltip = new vscode.MarkdownString();
		if (target) {
			tooltip.appendMarkdown(`**Agent:** ${name}\n\n`);
			if (target.cwd) {
				tooltip.appendMarkdown(`**Working directory:** \`${target.cwd}\`\n\n`);
			}
			tooltip.appendMarkdown(`**Pane:** \`${target.paneId}\`\n\n`);
		} else {
			tooltip.appendMarkdown('No target agent selected.\n\n');
		}
		tooltip.appendMarkdown(
			count > 0
				? `${count} comment${count === 1 ? '' : 's'} queued — click to send.`
				: 'Click to select a herdr agent.',
		);
		this.item.tooltip = tooltip;
		this.item.command = count > 0 ? 'herdr.sendAll' : 'herdr.pickAgent';
		this.item.show();
	}

	dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
	}
}
