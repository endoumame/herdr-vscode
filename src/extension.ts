import * as vscode from 'vscode';

import { getConfig } from './config.js';
import { HerdrCli } from './herdr/cli.js';
import { invalidateDiscoveryCache } from './herdr/discovery.js';
import { describe, Logger } from './log.js';
import { CaptureService } from './review/capture.js';
import { HerdrCommentController } from './review/commentController.js';
import { exportWithPreamble } from './review/export.js';
import { CommentQueue } from './review/queue.js';
import { commentIdOf, QueueTreeProvider } from './review/queueView.js';
import { Sender } from './review/sender.js';
import { TargetStatusBar } from './target/statusBar.js';
import { TargetStore } from './target/targetStore.js';

const WINDOWS_HINT_KEY = 'herdr.shownWindowsHint';

export function activate(context: vscode.ExtensionContext): void {
	const log = new Logger();
	const queue = new CommentQueue();
	const capture = new CaptureService(log);
	const cli = new HerdrCli(() => getConfig(), log);
	const target = new TargetStore(context, cli, log);
	const comments = new HerdrCommentController(queue, capture, log);
	const statusBar = new TargetStatusBar(target, queue);
	const tree = new QueueTreeProvider(queue);

	const sender = new Sender(
		cli,
		queue,
		target,
		log,
		ids => comments.disposeThreadsFor(ids),
		missing => statusBar.setBinaryMissing(missing),
	);

	context.subscriptions.push(
		log,
		queue,
		comments,
		statusBar,
		tree,
		target,
		vscode.window.registerTreeDataProvider('herdr.queue', tree),

		// Binary discovery is memoised for the session; a changed path must retry.
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('herdr.binPath')) {
				invalidateDiscoveryCache();
				statusBar.setBinaryMissing(false);
			}
		}),

		vscode.commands.registerCommand('herdr.commentSelection', () =>
			comments.commentOnSelection(),
		),
		vscode.commands.registerCommand('herdr.createComment', (reply: vscode.CommentReply) =>
			comments.createComment(reply),
		),
		vscode.commands.registerCommand(
			'herdr.createAndSend',
			async (reply: vscode.CommentReply) => {
				const queued = await comments.createComment(reply);
				if (queued) {
					await sender.sendAll();
				}
			},
		),
		vscode.commands.registerCommand('herdr.sendAll', () => sender.sendAll()),
		vscode.commands.registerCommand('herdr.sendOne', (arg: unknown) => {
			const id = commentIdOf(arg) ?? (typeof arg === 'string' ? arg : undefined);
			return id ? sender.sendOne(id) : undefined;
		}),
		vscode.commands.registerCommand('herdr.clearAll', async () => {
			if (queue.size === 0) {
				return;
			}
			const choice = await vscode.window.showWarningMessage(
				`Discard ${queue.size} queued comment${queue.size === 1 ? '' : 's'}?`,
				{ modal: true },
				'Discard',
			);
			if (choice === 'Discard') {
				queue.clear();
				comments.disposeAll();
			}
		}),
		vscode.commands.registerCommand('herdr.copyExport', async () => {
			if (queue.size === 0) {
				void vscode.window.showInformationMessage('herdr: no queued comments.');
				return;
			}
			await vscode.env.clipboard.writeText(
				exportWithPreamble(queue.snapshot(), getConfig().preamble),
			);
			void vscode.window.showInformationMessage(
				`herdr: copied ${queue.size} comment${queue.size === 1 ? '' : 's'} to the clipboard.`,
			);
		}),
		vscode.commands.registerCommand('herdr.pickAgent', async () => {
			try {
				target.invalidate();
				await target.resolve({ interactive: true });
			} catch (err) {
				reportTargetError(err, log, statusBar);
			}
		}),
		vscode.commands.registerCommand('herdr.refreshAgents', async () => {
			invalidateDiscoveryCache();
			target.invalidate();
			try {
				const agents = await target.listAgents(true);
				statusBar.setBinaryMissing(false);
				void vscode.window.showInformationMessage(
					`herdr: ${agents.length} agent${agents.length === 1 ? '' : 's'} running.`,
				);
			} catch (err) {
				reportTargetError(err, log, statusBar);
			}
		}),
		vscode.commands.registerCommand('herdr.focusAgent', async () => {
			try {
				const agent = await target.resolve();
				await cli.agentFocus(agent.paneId);
			} catch (err) {
				reportTargetError(err, log, statusBar);
			}
		}),
		vscode.commands.registerCommand('herdr.showLog', () => log.show()),
		vscode.commands.registerCommand('herdr.editComment', (c: vscode.Comment) =>
			comments.editComment(c),
		),
		vscode.commands.registerCommand('herdr.saveComment', (c: vscode.Comment) =>
			comments.saveComment(c),
		),
		vscode.commands.registerCommand('herdr.cancelEditComment', (c: vscode.Comment) =>
			comments.cancelEdit(c),
		),
		vscode.commands.registerCommand('herdr.deleteComment', (arg: unknown) => {
			const id = commentIdOf(arg);
			if (id) {
				comments.removeQueued(id);
			} else {
				comments.deleteComment(arg as vscode.Comment);
			}
		}),
		vscode.commands.registerCommand('herdr.deleteThread', (thread: vscode.CommentThread) =>
			comments.deleteThread(thread),
		),
		vscode.commands.registerCommand('herdr.revealComment', async (id: string) => {
			const comment = queue.get(id);
			if (!comment) {
				return;
			}
			const doc = await vscode.workspace.openTextDocument(comment.uri);
			await vscode.window.showTextDocument(doc, { selection: comment.range, preview: true });
		}),

		// Nothing is silently lost when the window closes.
		new vscode.Disposable(() => {
			if (queue.size > 0) {
				log.debug(
					`unsent comments at shutdown:\n${exportWithPreamble(queue.snapshot(), getConfig().preamble)}`,
				);
			}
		}),
	);

	if (process.platform === 'win32' && !context.globalState.get<boolean>(WINDOWS_HINT_KEY)) {
		void context.globalState.update(WINDOWS_HINT_KEY, true);
		void vscode.window.showInformationMessage(
			'herdr Review: herdr is a Unix terminal multiplexer. On Windows, run VS Code in WSL so the extension host sits next to herdr.',
		);
	}
}

export function deactivate(): void {
	// Everything is registered in context.subscriptions.
}

function reportTargetError(err: unknown, log: Logger, statusBar: TargetStatusBar): void {
	if (err instanceof Error && err.name === 'TargetCancelledError') {
		return;
	}
	if (err instanceof Error && err.name === 'HerdrNotFoundError') {
		statusBar.setBinaryMissing(true);
	}
	log.error('agent lookup failed', err);
	void vscode.window.showErrorMessage(`herdr: ${describe(err)}`);
}
