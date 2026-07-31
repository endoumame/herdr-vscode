import * as vscode from 'vscode';

import { getConfig } from '../config.js';
import type { Logger } from '../log.js';
import { CaptureService, normalizeSelection } from './capture.js';
import { formatLocation } from './export.js';
import type { CommentQueue, QueuedComment } from './queue.js';

const CONTROLLER_ID = 'herdr.review';

/**
 * A thread's contextValue, which drives the `when` clauses of its title menu.
 *
 * Every comment already carries its own delete action, so on a single-comment
 * thread a "Discard Thread" button in the header is a second trash can that
 * does the same thing. It only earns its place once there is more than one
 * comment to discard at once.
 */
const THREAD_SINGLE = 'herdr.thread';
const THREAD_MULTI = 'herdr.threadMulti';

function tagThread(thread: vscode.CommentThread): void {
	thread.contextValue = thread.comments.length > 1 ? THREAD_MULTI : THREAD_SINGLE;
}

/** VS Code's own Escape handler for comment widgets. See `closeEditors`. */
const HIDE_COMMENT_COMMAND = 'workbench.action.hideComment';

/** A comment we put in a thread, tagged with the queue entry it mirrors. */
interface HerdrComment extends vscode.Comment {
	queueId: string;
	thread: vscode.CommentThread;
}

export class HerdrCommentController implements vscode.Disposable {
	private readonly controller: vscode.CommentController;
	private readonly threadsById = new Map<string, vscode.CommentThread>();
	/**
	 * Threads created by the shortcut that never received a comment. Disposed
	 * when the user moves on, so an abandoned widget does not linger.
	 */
	private readonly pendingEmpty = new Set<vscode.CommentThread>();
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly queue: CommentQueue,
		private readonly capture: CaptureService,
		private readonly log: Logger,
	) {
		this.controller = vscode.comments.createCommentController(CONTROLLER_ID, 'herdr');
		this.controller.options = {
			prompt: 'Comment for the herdr agent…',
			placeHolder: 'What should the agent change here?',
		};
		this.controller.commentingRangeProvider = {
			provideCommentingRanges: document => this.commentingRanges(document),
		};
		this.disposables.push(
			this.controller,
			vscode.window.onDidChangeActiveTextEditor(() => this.disposeAbandoned()),
		);
	}

	private commentingRanges(document: vscode.TextDocument): vscode.Range[] {
		const schemes = getConfig().commentingSchemes;
		// Return [] rather than undefined for unsupported schemes: undefined
		// reads as "provider not ready" and gets retried.
		if (!schemes.includes(document.uri.scheme) || document.lineCount === 0) {
			return [];
		}
		const last = document.lineCount - 1;
		return [new vscode.Range(0, 0, last, document.lineAt(last).text.length)];
	}

	/**
	 * The shortcut path. Creating an expanded, replyable, *empty* thread makes
	 * VS Code open our own comment editor focused at the selection: multi-line
	 * input, no gutter click, and no "Select Comment Provider" step even on PR
	 * diffs where the GitHub extension owns a controller too.
	 */
	async commentOnSelection(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		const range = normalizeSelection(editor.selection, editor.document);
		const loc = await this.capture.resolve(editor.document.uri, range);
		if (loc === null) {
			void vscode.window.showWarningMessage(
				`herdr: cannot comment on ${editor.document.uri.scheme}: documents.`,
			);
			return;
		}

		this.disposeAbandoned();
		const thread = this.controller.createCommentThread(editor.document.uri, range, []);
		thread.canReply = true;
		thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
		thread.label = `herdr · ${formatLocation(loc)}`;
		tagThread(thread);
		this.pendingEmpty.add(thread);
	}

	/** Reply handler: validate, capture, queue, and render into the thread. */
	async createComment(reply: vscode.CommentReply): Promise<QueuedComment | undefined> {
		const text = reply.text;
		if (text.trim().length === 0) {
			// A body that normalises to nothing would emit a trailing newline and
			// break the "\n\n" block separation of the payload.
			void vscode.window.showWarningMessage('herdr: the comment is empty.');
			return undefined;
		}

		const thread = reply.thread;
		// `range` is optional in the API for file-level threads; ours are always
		// line-anchored, but fall back to the first line rather than dropping the
		// comment on the floor.
		const range = thread.range ?? new vscode.Range(0, 0, 0, 0);
		const captured = await this.capture.capture(thread.uri, range, text);
		if (!captured) {
			void vscode.window.showWarningMessage(
				`herdr: cannot resolve a location for ${thread.uri.toString()}.`,
			);
			return undefined;
		}

		this.queue.add(captured);
		this.threadsById.set(captured.id, thread);
		this.pendingEmpty.delete(thread);

		const comment: HerdrComment = {
			queueId: captured.id,
			thread,
			body: new vscode.MarkdownString(text),
			mode: vscode.CommentMode.Preview,
			author: { name: 'herdr (queued)' },
			contextValue: 'herdr.draft',
			label: formatLocation(captured.location),
		};
		// Reassign rather than push: mutating the array does not repaint.
		thread.comments = [...thread.comments, comment];
		thread.label = `herdr · ${formatLocation(captured.location)}`;
		tagThread(thread);
		thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;

		this.log.debug(`queued ${formatLocation(captured.location)}`);
		return captured;
	}

	/**
	 * Escape while a herdr comment editor has focus.
	 *
	 * VS Code gives the command no argument, and there is no context key for
	 * "the thread you are typing in", so this closes every editor we own rather
	 * than guessing. That is cheap and never destructive: an edit in progress
	 * reverts to what is queued, a thread the shortcut opened but never filled
	 * disappears, and a thread with queued comments merely collapses. Nothing
	 * leaves the queue.
	 *
	 * VS Code binds Escape to `workbench.action.hideComment` at EditorContrib
	 * weight, and an extension keybinding outranks that, so this has to hand
	 * off at the end rather than replace it — otherwise a thread opened from
	 * the gutter, which we never see, would lose its Escape.
	 */
	async closeEditors(): Promise<void> {
		for (const thread of this.threadsById.values()) {
			for (const comment of thread.comments) {
				if (comment.mode === vscode.CommentMode.Editing) {
					this.cancelEdit(comment);
				}
			}
			thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
		}
		this.disposeAbandoned();

		try {
			await vscode.commands.executeCommand(HIDE_COMMENT_COMMAND);
		} catch (err) {
			// A renamed or removed built-in must not turn Escape into an error
			// notification; our own cleanup has already run.
			this.log.debug(`${HIDE_COMMENT_COMMAND} failed: ${String(err)}`);
		}
	}

	editComment(comment: vscode.Comment): void {
		const target = asHerdrComment(comment);
		if (!target) {
			return;
		}
		target.thread.comments = target.thread.comments.map(c =>
			c === comment ? { ...c, mode: vscode.CommentMode.Editing } : c,
		);
	}

	saveComment(comment: vscode.Comment): void {
		const target = asHerdrComment(comment);
		if (!target) {
			return;
		}
		const text = bodyText(comment.body);
		if (text.trim().length === 0) {
			void vscode.window.showWarningMessage('herdr: the comment is empty.');
			return;
		}
		this.queue.update(target.queueId, text);
		target.thread.comments = target.thread.comments.map(c =>
			c === comment ? { ...c, mode: vscode.CommentMode.Preview } : c,
		);
	}

	cancelEdit(comment: vscode.Comment): void {
		const target = asHerdrComment(comment);
		if (!target) {
			return;
		}
		const original = this.queue.get(target.queueId);
		target.thread.comments = target.thread.comments.map(c =>
			c === comment
				? {
						...c,
						mode: vscode.CommentMode.Preview,
						body: new vscode.MarkdownString(original?.text ?? bodyText(c.body)),
					}
				: c,
		);
	}

	deleteComment(comment: vscode.Comment): void {
		const target = asHerdrComment(comment);
		if (!target) {
			return;
		}
		this.removeQueued(target.queueId);
	}

	deleteThread(thread: vscode.CommentThread): void {
		for (const comment of thread.comments) {
			const target = asHerdrComment(comment);
			if (target) {
				this.queue.remove(target.queueId);
				this.threadsById.delete(target.queueId);
			}
		}
		this.pendingEmpty.delete(thread);
		thread.dispose();
	}

	removeQueued(id: string): void {
		this.queue.remove(id);
		const thread = this.threadsById.get(id);
		this.threadsById.delete(id);
		if (!thread) {
			return;
		}
		const remaining = thread.comments.filter(c => asHerdrComment(c)?.queueId !== id);
		if (remaining.length === 0) {
			thread.dispose();
		} else {
			thread.comments = remaining;
			tagThread(thread);
		}
	}

	/** Called after a successful send. */
	disposeThreadsFor(ids: readonly string[]): void {
		for (const id of ids) {
			const thread = this.threadsById.get(id);
			this.threadsById.delete(id);
			thread?.dispose();
		}
		this.disposeAbandoned();
	}

	disposeAll(): void {
		for (const thread of this.threadsById.values()) {
			thread.dispose();
		}
		this.threadsById.clear();
		this.disposeAbandoned();
	}

	private disposeAbandoned(): void {
		for (const thread of this.pendingEmpty) {
			if (thread.comments.length === 0) {
				thread.dispose();
			}
		}
		this.pendingEmpty.clear();
	}

	dispose(): void {
		this.disposeAll();
		for (const d of this.disposables) {
			d.dispose();
		}
	}
}

function asHerdrComment(comment: vscode.Comment): HerdrComment | undefined {
	const candidate = comment as Partial<HerdrComment>;
	return typeof candidate.queueId === 'string' && candidate.thread
		? (comment as HerdrComment)
		: undefined;
}

function bodyText(body: vscode.Comment['body']): string {
	return typeof body === 'string' ? body : body.value;
}
