/**
 * The settings snapshot, and the caching in front of it.
 *
 * `provideCommentingRanges` is called by VS Code for every document that opens
 * and again whenever one changes, and it needs the scheme list; the status bar
 * refreshes on every queue mutation. Reading fourteen keys out of a fresh
 * `WorkspaceConfiguration` on each of those is pure waste, so the snapshot is
 * taken once and held until VS Code says a `herdr.*` setting changed.
 *
 * This module stays vscode-free — `ConfigSource` is the structural slice of
 * `vscode.WorkspaceConfiguration` that the reader actually uses.
 */

import { memoize } from './util/memo.js';

import type { CliSettings } from './herdr/cli.js';
import type { SnippetPrefix } from './review/snippet.js';

export const CONFIG_SECTION = 'herdr';

export interface HerdrConfig extends CliSettings {
	focusAgentAfterSend: boolean;
	snippetMaxLines: number;
	snippetPrefix: SnippetPrefix;
	agentMatchStrategy: 'cwd' | 'any';
	/** A set rather than an array: the gutter check runs per document. */
	commentingSchemes: ReadonlySet<string>;
	showStatusBar: boolean;
	clearThreadsAfterSend: boolean;
	preamble: string;
}

/** The slice of `vscode.WorkspaceConfiguration` this module needs. */
export interface ConfigSource {
	get<T>(key: string, defaultValue: T): T;
}

export interface ConfigReader {
	get(): HerdrConfig;
	invalidate(): void;
}

export function readHerdrConfig(source: ConfigSource): HerdrConfig {
	return {
		binPath: source.get<string>('binPath', ''),
		session: source.get<string>('session', ''),
		socketPath: source.get<string>('socketPath', ''),
		extraArgs: source.get<string[]>('extraArgs', []),
		commandTimeoutMs: source.get<number>('commandTimeoutMs', 10000),
		bracketedPaste: source.get<'always' | 'never'>('bracketedPaste', 'always'),
		focusAgentAfterSend: source.get<boolean>('focusAgentAfterSend', true),
		snippetMaxLines: source.get<number>('snippetMaxLines', 40),
		snippetPrefix: source.get<SnippetPrefix>('snippetPrefix', 'auto'),
		agentMatchStrategy: source.get<'cwd' | 'any'>('agentMatchStrategy', 'cwd'),
		commentingSchemes: new Set(source.get<string[]>('commentingSchemes', []) ?? []),
		showStatusBar: source.get<boolean>('showStatusBar', true),
		clearThreadsAfterSend: source.get<boolean>('clearThreadsAfterSend', true),
		preamble: source.get<string>('preamble', ''),
	};
}

/**
 * `open` is called per computation rather than once, because a
 * `WorkspaceConfiguration` is a snapshot: reusing one across an invalidation
 * would keep serving the values from before the change.
 */
export function createConfigReader(open: () => ConfigSource): ConfigReader {
	return memoize(() => readHerdrConfig(open()));
}
