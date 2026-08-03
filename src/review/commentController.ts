import * as vscode from 'vscode';

import { getConfig } from '../config.js';
import type { Logger } from '../log.js';
import { CaptureService, normalizeSelection } from './capture.js';
import { formatLocation } from './export.js';
import type { CommentQueue, QueuedComment } from './queue.js';
import { THREAD_MULTI, THREAD_SINGLE } from './threadContext.js';

const CONTROLLER_ID = 'herdr.review';

/**
 * Tag a thread so its title menu can tell the two shapes apart.
 *
 * Every comment already carries its own delete action, so on a single-comment
 * thread a "Discard Thread" button in the header is a second trash can that
 * does the same thing. It only earns its place once there is more than one
 * comment to discard at once.
 */
function tagThread(thread: vscode.CommentThread): void {
	thread.contextValue = thread.comments.length > 1 ? THREAD_MULTI : THREAD_SINGLE;
}

/**
 * Collapse a thread whose widget the user may have expanded by hand.
 *
 * A plain `collapsibleState = Collapsed` is not enough. Since VS Code 1.96 the
 * extension host drops any write that matches the value it last saw, and it is
 * never told that the user re-opened a widget from the gutter — the workbench
 * keeps that to itself. So for every thread this extension already collapsed
 * once, on queueing, the assignment is a silent no-op and the widget stays
 * open.
 *
 * Writing `Expanded` first makes the assignment a real change. Both writes
 * land in the same debounced update, which carries only the final value, so
 * the widget never actually expands on the way through.
 */
function collapseThread(thread: vscode.CommentThread): void {
	thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
	thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
}

/**
 * VS Code's own Ctrl+Enter handler for comment widgets. It runs the first
 * action of the widget's menu — for us `herdr.createComment` — and is the only
 * thing that can hand that command the reply it needs. See `createComment`.
 */
const SUBMIT_COMMENT_COMMAND = 'editor.action.submitComment';

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
		// Return [] rather than undefined for unsupported schemes: undefined
		// reads as "provider not ready" and gets retried.
		if (!getConfig().commentingSchemes.has(document.uri.scheme) || document.lineCount === 0) {
			return [];
		}
		// `validateRange` clamps to the real end of the document, which avoids
		// materialising the last line's text just to measure it — that line can
		// be a whole minified bundle, and this runs for every document opened.
		const last = document.lineCount - 1;
		return [document.validateRange(new vscode.Range(0, 0, last, Number.MAX_SAFE_INTEGER))];
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

	/**
	 * Reply handler: validate, capture, queue, and render into the thread.
	 *
	 * The reply — the thread plus the text in its editor — only ever arrives
	 * from the widget's own action. A keybinding invokes a command with no
	 * arguments at all, and nothing in the API reads the comment editor, so a
	 * shortcut bound straight at this command cannot work. Hand those off to
	 * VS Code's submit command, which runs the same action *with* the reply.
	 * It cannot come back here empty-handed: it does nothing at all when the
	 * editor is empty, and otherwise passes the reply through.
	 */
	async createComment(reply?: vscode.CommentReply): Promise<QueuedComment | undefined> {
		if (!reply) {
			await vscode.commands.executeCommand(SUBMIT_COMMENT_COMMAND);
			return undefined;
		}

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
		collapseThread(thread);

		this.log.debug(`queued ${formatLocation(captured.location)}`);
		return captured;
	}

	/**
	 * Close every comment editor this extension owns. Bound to nothing by
	 * default; Escape belongs to VS Code.
	 *
	 * VS Code binds Escape in a comment widget to `workbench.action.hideComment`,
	 * which reaches the widget through `getFocusedCodeEditor()` and collapses it
	 * in the workbench — and deletes the thread outright when it holds no
	 * comments. Nothing here can match that. A command invoked from a keybinding
	 * gets no argument, and the API has no "the thread you are typing in", so
	 * this walks every thread we track instead of the one in front of the user;
	 * threads we never saw, such as the widget behind the gutter `+`, it cannot
	 * reach at all. Its writes then go back through the extension host, where a
	 * `collapsibleState` that matches the last value is dropped and the rest is
	 * flushed on a 100ms debounce.
	 *
	 * A contributed keybinding is registered at `ExternalExtension` weight and
	 * outranks the `EditorContrib` weight of VS Code's own, so binding Escape
	 * here does not add this handler to that one — it replaces it. That is why
	 * `package.json` binds no key to this command. Rebind it by hand if the
	 * blanket close is what you want.
	 *
	 * What it does is cheap and never destructive: an edit in progress reverts
	 * to what is queued, a thread the shortcut opened but never filled
	 * disappears, and a thread with queued comments collapses. Nothing leaves
	 * the queue.
	 */
	closeEditors(): void {
		for (const thread of this.threadsById.values()) {
			for (const comment of thread.comments) {
				if (comment.mode === vscode.CommentMode.Editing) {
					this.cancelEdit(comment);
				}
			}
			collapseThread(thread);
		}
		this.disposeAbandoned();
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

	/**
	 * Drop a thread the shortcut opened but never filled.
	 *
	 * VS Code gets there first whenever the widget is closed from the keyboard:
	 * hiding a comment thread that holds no comments deletes it. Disposing it
	 * again here sends a second delete for a handle the workbench has already
	 * forgotten, which it answers with "unknown thread" in the extension host
	 * log. Nothing reaches the user, and there is no way to ask a thread whether
	 * it is still alive, so the log line stands.
	 *
	 * The case this still earns its place for is a widget the user walked away
	 * from with the editor, which VS Code leaves open.
	 */
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
