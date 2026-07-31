import * as vscode from 'vscode';

import type { ExportableComment, ExportLocation } from './export.js';

export interface QueuedComment extends ExportableComment {
	id: string;
	uri: vscode.Uri;
	/** 0-based range in the document the comment was written against. */
	range: vscode.Range;
	location: ExportLocation;
	snippet: string[];
	text: string;
}

let counter = 0;

export function nextCommentId(): string {
	counter += 1;
	return `herdr-${counter}`;
}

/**
 * In-memory only, matching herdr-reviewr: a queued comment references a live
 * CommentThread and a possibly transient diff document, and resurrecting those
 * across a window reload is out of scope. Nothing is silently lost — the
 * export text is written to the log on dispose.
 */
export class CommentQueue implements vscode.Disposable {
	private readonly items = new Map<string, QueuedComment>();
	private readonly emitter = new vscode.EventEmitter<void>();

	readonly onDidChange = this.emitter.event;

	get size(): number {
		return this.items.size;
	}

	add(comment: QueuedComment): void {
		this.items.set(comment.id, comment);
		this.emitter.fire();
	}

	update(id: string, text: string): void {
		const existing = this.items.get(id);
		if (!existing) {
			return;
		}
		this.items.set(id, { ...existing, text });
		this.emitter.fire();
	}

	get(id: string): QueuedComment | undefined {
		return this.items.get(id);
	}

	remove(id: string): void {
		if (this.items.delete(id)) {
			this.emitter.fire();
		}
	}

	clear(): void {
		if (this.items.size === 0) {
			return;
		}
		this.items.clear();
		this.emitter.fire();
	}

	snapshot(): QueuedComment[] {
		return [...this.items.values()];
	}

	dispose(): void {
		this.emitter.dispose();
	}
}
