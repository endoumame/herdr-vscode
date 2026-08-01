import * as vscode from 'vscode';

import { getConfig } from '../config.js';
import type { HerdrCli } from '../herdr/cli.js';
import { HerdrNotFoundError, NoAgentsError, TargetCancelledError } from '../herdr/errors.js';
import { describe, type Logger } from '../log.js';
import { label, type TargetStore } from '../target/targetStore.js';
import { exportWithPreamble } from './export.js';
import type { CommentQueue, QueuedComment } from './queue.js';

/**
 * Linux caps a *single* argv entry at MAX_ARG_STRLEN (128 KiB) independently of
 * the ~2 MiB total, and the whole payload rides as one argument. Warn before
 * we get close.
 */
const LARGE_PAYLOAD_WARN = 100_000;

export interface SendOutcome {
	sent: QueuedComment[];
}

export class Sender {
	constructor(
		private readonly cli: HerdrCli,
		private readonly queue: CommentQueue,
		private readonly target: TargetStore,
		private readonly log: Logger,
		private readonly onSent: (ids: string[]) => void,
		private readonly onBinaryMissing: (missing: boolean) => void,
	) {}

	async sendAll(): Promise<void> {
		await this.send(this.queue.snapshot(), 'all');
	}

	async sendOne(id: string): Promise<void> {
		const comment = this.queue.get(id);
		if (!comment) {
			return;
		}
		await this.send([comment], 'one');
	}

	private async send(items: readonly QueuedComment[], mode: 'all' | 'one'): Promise<void> {
		if (items.length === 0) {
			void vscode.window.showInformationMessage('herdr: no queued comments.');
			return;
		}

		const cfg = getConfig();
		const payload = exportWithPreamble(items, cfg.preamble);

		const payloadBytes = Buffer.byteLength(payload, 'utf8');
		if (payloadBytes > LARGE_PAYLOAD_WARN) {
			const kb = Math.round(payloadBytes / 1024);
			const choice = await vscode.window.showWarningMessage(
				`herdr: this payload is ${kb} KB and may exceed the operating system's argument size limit.`,
				'Send Anyway',
				'Cancel',
			);
			if (choice !== 'Send Anyway') {
				return;
			}
		}

		try {
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'herdr: sending comments…' },
				async () => {
					// Resolve the target first. It can fail, go stale, or be
					// cancelled, and none of that may cost the user their queue.
					const agent = await this.target.resolve();
					this.onBinaryMissing(false);

					await this.cli.paneSendText(agent.paneId, payload);

					// Past this point the text has been delivered. Never roll back:
					// the agent already has it, so a retry would duplicate.
					const ids = items.map(i => i.id);
					if (mode === 'all') {
						this.queue.clear();
					} else {
						for (const id of ids) {
							this.queue.remove(id);
						}
					}
					if (cfg.clearThreadsAfterSend) {
						this.onSent(ids);
					}

					if (cfg.focusAgentAfterSend) {
						try {
							await this.cli.agentFocus(agent.paneId);
						} catch (err) {
							this.log.warn(`agent focus failed: ${describe(err)}`);
						}
					}

					void vscode.window.showInformationMessage(
						`herdr: sent ${items.length} comment${items.length === 1 ? '' : 's'} to "${label(agent)}". Press Enter in the agent pane to submit.`,
					);
				},
			);
		} catch (err) {
			await this.reportFailure(err, payload);
		}
	}

	private async reportFailure(err: unknown, payload: string): Promise<void> {
		if (err instanceof TargetCancelledError) {
			return; // the user dismissed the picker; the queue is intact
		}

		this.log.error('send failed', err);

		let message: string;
		const actions = ['Retry', 'Change Agent', 'Copy to Clipboard', 'Show Log'];

		if (err instanceof HerdrNotFoundError) {
			this.onBinaryMissing(true);
			message = `herdr: could not find the herdr binary. Looked at: ${err.probed.slice(0, 6).join(', ')}${err.probed.length > 6 ? ', …' : ''}. Your comments are still queued.`;
			actions.splice(1, 1, 'Set Path…');
		} else if (err instanceof NoAgentsError) {
			message = 'herdr: no agents are running. Your comments are still queued.';
			actions.splice(0, 2, 'Refresh');
		} else {
			message = `herdr: ${describe(err)}. Your comments are still queued.`;
		}

		const choice = await vscode.window.showErrorMessage(message, ...actions);
		switch (choice) {
			case 'Retry':
			case 'Refresh':
				this.target.invalidate();
				await this.sendAll();
				break;
			case 'Change Agent':
				await vscode.commands.executeCommand('herdr.pickAgent');
				break;
			case 'Set Path…':
				await vscode.commands.executeCommand(
					'workbench.action.openSettings',
					'herdr.binPath',
				);
				break;
			case 'Copy to Clipboard':
				await vscode.env.clipboard.writeText(payload);
				void vscode.window.showInformationMessage('herdr: comments copied to the clipboard.');
				break;
			case 'Show Log':
				this.log.show();
				break;
			default:
				break;
		}
	}
}
