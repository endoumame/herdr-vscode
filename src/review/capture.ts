import * as vscode from 'vscode';

import { getConfig } from '../config.js';
import type { Logger } from '../log.js';
import { collectRoots } from '../util/git.js';
import { applyDiffSide } from './diffSide.js';
import { resolveLocation, type ResolvedLocation } from './location.js';
import { nextCommentId, type QueuedComment } from './queue.js';
import { buildSnippet, snippetLinesToRead } from './snippet.js';

/**
 * Turns an editor position into something sendable: a repository-relative
 * location plus the lines it points at.
 */
export class CaptureService {
	private readonly warnedSchemes = new Set<string>();
	/** `review:` URIs carry a rootPath that is worth folding into the root set. */
	private readonly harvestedRoots = new Set<string>();

	constructor(private readonly log: Logger) {}

	async resolve(uri: vscode.Uri, range: vscode.Range): Promise<ResolvedLocation | null> {
		this.harvestRoot(uri);
		const roots = await collectRoots(this.harvestedRoots);
		const loc = resolveLocation(uri, {
			startLine: range.start.line,
			endLine: range.end.line,
			roots,
			onUnknownScheme: scheme => this.warnOnce(scheme),
		});
		if (loc === null) {
			return null;
		}
		return applyDiffSide(uri, loc);
	}

	async capture(
		uri: vscode.Uri,
		range: vscode.Range,
		text: string,
	): Promise<QueuedComment | null> {
		const loc = await this.resolve(uri, range);
		if (loc === null) {
			return null;
		}
		const cfg = getConfig();
		// A selection can be arbitrarily long while the snippet keeps at most
		// `snippetMaxLines` of it, so only that many lines are ever read; the
		// span is reported separately for the elision marker's count.
		const { lines, total } = await this.readLines(uri, range, snippetLinesToRead(cfg));
		const snippet = buildSnippet(lines, loc, {
			snippetPrefix: cfg.snippetPrefix,
			snippetMaxLines: cfg.snippetMaxLines,
			totalLines: total,
		});
		return {
			id: nextCommentId(),
			uri,
			range,
			location: {
				path: loc.path,
				startLine: loc.startLine,
				endLine: loc.endLine,
				isBaseSide: loc.isBaseSide,
			},
			snippet,
			text,
		};
	}

	/**
	 * Read at most `limit` lines of the selection, and report how many it spans.
	 *
	 * Every scheme above is backed by a TextDocumentContentProvider, so this
	 * works even for a PR whose blobs come off the network. If the provider
	 * fails anyway, queue the comment with an empty snippet — a location plus a
	 * body is far more useful than a lost comment. The span is reported as zero
	 * in that case, so a failed read never produces a bare elision marker.
	 */
	private async readLines(
		uri: vscode.Uri,
		range: vscode.Range,
		limit: number,
	): Promise<{ lines: string[]; total: number }> {
		if (limit <= 0) {
			return { lines: [], total: 0 }; // snippets are off; no need to open anything
		}
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			const last = Math.min(range.end.line, doc.lineCount - 1);
			const total = Math.max(0, last - range.start.line + 1);
			const wanted = Math.min(total, limit);
			const lines: string[] = new Array<string>(wanted);
			for (let i = 0; i < wanted; i++) {
				lines[i] = doc.lineAt(range.start.line + i).text;
			}
			return { lines, total };
		} catch (err) {
			this.log.warn(`could not read ${uri.toString()} for a snippet: ${String(err)}`);
			return { lines: [], total: 0 };
		}
	}

	private harvestRoot(uri: vscode.Uri): void {
		if (uri.scheme !== 'review' || !uri.query.startsWith('{')) {
			return;
		}
		try {
			const params: unknown = JSON.parse(uri.query);
			const rootPath = (params as Record<string, unknown>)['rootPath'];
			if (typeof rootPath === 'string' && rootPath.length > 0) {
				this.harvestedRoots.add(rootPath);
			}
		} catch {
			// Malformed query; the ordinary root discovery still applies.
		}
	}

	private warnOnce(scheme: string): void {
		if (this.warnedSchemes.has(scheme)) {
			return;
		}
		this.warnedSchemes.add(scheme);
		this.log.warn(`unrecognised URI scheme "${scheme}"; falling back to the raw path`);
	}
}

/**
 * A selection that ends at character 0 of the line below the start means the
 * user dragged *to* that line but not into it, so it should not be included.
 * An empty selection means the cursor's line.
 */
export function normalizeSelection(selection: vscode.Selection, document: vscode.TextDocument): vscode.Range {
	const start = selection.start;
	let endLine = selection.end.line;
	if (endLine > start.line && selection.end.character === 0) {
		endLine -= 1;
	}
	const clamped = Math.min(endLine, Math.max(0, document.lineCount - 1));
	// `validateRange` clamps the end column for us, so the line's text never
	// has to be materialised just to measure it.
	return document.validateRange(
		new vscode.Range(start.line, 0, clamped, Number.MAX_SAFE_INTEGER),
	);
}
