import * as vscode from 'vscode';

import type { HerdrAgent } from '../herdr/types.js';
import { rankOf, type Candidate } from './agentMatch.js';

interface AgentItem extends vscode.QuickPickItem {
	agent?: HerdrAgent;
}

export interface PickOptions {
	/** False when nothing matched this workspace and we are offering everything. */
	matchedWorkspace: boolean;
}

export async function pickAgent(
	candidates: readonly Candidate[],
	opts: PickOptions,
): Promise<HerdrAgent | undefined> {
	const matching = candidates.filter(c => rankOf(c.quality) > 0);
	const others = candidates.filter(c => rankOf(c.quality) === 0);

	const items: AgentItem[] = [];
	if (matching.length > 0) {
		items.push({ label: 'Matching this workspace', kind: vscode.QuickPickItemKind.Separator });
		items.push(...matching.map(toItem));
	}
	if (others.length > 0) {
		items.push({
			label: matching.length > 0 ? 'Other agents' : 'All running agents',
			kind: vscode.QuickPickItemKind.Separator,
		});
		items.push(...others.map(toItem));
	}

	const picked = await vscode.window.showQuickPick(items, {
		title: 'herdr: select the agent to send comments to',
		placeHolder: opts.matchedWorkspace
			? 'Pick an agent'
			: 'No agent working directory matches this workspace — showing all agents',
		matchOnDescription: true,
		matchOnDetail: true,
		ignoreFocusOut: true,
	});
	return picked?.agent;
}

function toItem(candidate: Candidate): AgentItem {
	const { agent, quality } = candidate;
	const star = quality === 'exact' ? '$(star-full) ' : '';
	const name = agent.displayAgent ?? agent.agent;
	const description = [agent.name, agent.agentStatus, ...agent.stateLabels]
		.filter((s): s is string => Boolean(s))
		.join(' · ');
	const detail = [agent.cwd ?? '(working directory unknown)', `pane ${agent.paneId}`]
		.concat(agent.tabId ? [`tab ${agent.tabId}`] : [])
		.join(' · ');
	return { label: `${star}$(hubot) ${name}`, description, detail, agent };
}
