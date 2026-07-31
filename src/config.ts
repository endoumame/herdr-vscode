import * as vscode from 'vscode';

import type { CliSettings } from './herdr/cli.js';
import type { SnippetPrefix } from './review/snippet.js';

export interface HerdrConfig extends CliSettings {
	focusAgentAfterSend: boolean;
	snippetMaxLines: number;
	snippetPrefix: SnippetPrefix;
	agentMatchStrategy: 'cwd' | 'any';
	commentingSchemes: string[];
	showStatusBar: boolean;
	clearThreadsAfterSend: boolean;
	preamble: string;
}

export function getConfig(): HerdrConfig {
	const c = vscode.workspace.getConfiguration('herdr');
	return {
		binPath: c.get<string>('binPath', ''),
		session: c.get<string>('session', ''),
		socketPath: c.get<string>('socketPath', ''),
		extraArgs: c.get<string[]>('extraArgs', []),
		commandTimeoutMs: c.get<number>('commandTimeoutMs', 10000),
		bracketedPaste: c.get<'always' | 'never'>('bracketedPaste', 'always'),
		focusAgentAfterSend: c.get<boolean>('focusAgentAfterSend', true),
		snippetMaxLines: c.get<number>('snippetMaxLines', 40),
		snippetPrefix: c.get<SnippetPrefix>('snippetPrefix', 'auto'),
		agentMatchStrategy: c.get<'cwd' | 'any'>('agentMatchStrategy', 'cwd'),
		commentingSchemes: c.get<string[]>('commentingSchemes', []),
		showStatusBar: c.get<boolean>('showStatusBar', true),
		clearThreadsAfterSend: c.get<boolean>('clearThreadsAfterSend', true),
		preamble: c.get<string>('preamble', ''),
	};
}
