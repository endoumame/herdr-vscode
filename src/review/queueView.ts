import * as vscode from 'vscode';

import { firstNonBlankLine } from '../util/text.js';
import { formatLocation } from './export.js';
import type { CommentQueue, QueuedComment } from './queue.js';

/** How much of a comment body fits on one line of the tree. */
const LABEL_MAX = 60;

type Node = FileNode | CommentNode;

interface FileNode {
	kind: 'file';
	path: string;
	comments: QueuedComment[];
}

interface CommentNode {
	kind: 'comment';
	comment: QueuedComment;
}

export class QueueTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<Node | undefined>();
	private readonly subscription: vscode.Disposable;

	readonly onDidChangeTreeData = this.emitter.event;

	constructor(private readonly queue: CommentQueue) {
		this.subscription = this.queue.onDidChange(() => this.emitter.fire(undefined));
	}

	getTreeItem(node: Node): vscode.TreeItem {
		if (node.kind === 'file') {
			const item = new vscode.TreeItem(node.path, vscode.TreeItemCollapsibleState.Expanded);
			item.iconPath = vscode.ThemeIcon.File;
			item.resourceUri = vscode.Uri.file(node.path);
			item.description = `${node.comments.length}`;
			item.contextValue = 'herdr.queuedFile';
			return item;
		}

		const { comment } = node;
		const span =
			comment.location.startLine === comment.location.endLine
				? `${comment.location.startLine}`
				: `${comment.location.startLine}-${comment.location.endLine}`;
		const item = new vscode.TreeItem(`${span}: ${firstNonBlankLine(comment.text, LABEL_MAX)}`);
		item.iconPath = new vscode.ThemeIcon('comment');
		item.tooltip = new vscode.MarkdownString(
			`\`${formatLocation(comment.location)}\`\n\n${comment.text}`,
		);
		item.contextValue = 'herdr.queuedComment';
		item.id = comment.id;
		item.command = {
			command: 'herdr.revealComment',
			title: 'Reveal Comment',
			arguments: [comment.id],
		};
		return item;
	}

	getChildren(node?: Node): Node[] {
		if (node === undefined) {
			const byFile = new Map<string, QueuedComment[]>();
			for (const comment of this.queue.snapshot()) {
				const bucket = byFile.get(comment.location.path) ?? [];
				bucket.push(comment);
				byFile.set(comment.location.path, bucket);
			}
			return [...byFile.entries()]
				.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
				.map(([path, comments]) => ({
					kind: 'file' as const,
					path,
					comments: comments.sort((a, b) => a.location.startLine - b.location.startLine),
				}));
		}
		if (node.kind === 'file') {
			return node.comments.map(comment => ({ kind: 'comment' as const, comment }));
		}
		return [];
	}

	dispose(): void {
		this.subscription.dispose();
		this.emitter.dispose();
	}
}

export function commentIdOf(node: unknown): string | undefined {
	const candidate = node as { kind?: string; comment?: QueuedComment } | undefined;
	return candidate?.kind === 'comment' ? candidate.comment?.id : undefined;
}
