import type { HerdrAgent } from '../herdr/types.js';

/**
 * Picking the target agent by working directory.
 *
 * herdr-reviewr runs inside a herdr pane, so it filters by its own
 * `HERDR_WORKSPACE_ID` and excludes its own `HERDR_PANE_ID`. The VS Code
 * extension host has neither, so the agent's reported `cwd` stands in for
 * both.
 */

export type MatchQuality = 'exact' | 'agent-under-root' | 'root-under-agent' | 'none';

const RANK: Record<MatchQuality, number> = {
	exact: 3,
	'agent-under-root': 2,
	'root-under-agent': 1,
	none: 0,
};

export interface Candidate {
	agent: HerdrAgent;
	quality: MatchQuality;
	matchedRoot?: string;
}

export function rankOf(quality: MatchQuality): number {
	return RANK[quality];
}

/** Score every agent against the known roots, best match first. */
export function scoreAgents(
	agents: readonly HerdrAgent[],
	roots: readonly string[],
): Candidate[] {
	return agents
		.map(agent => {
			let best: Candidate = { agent, quality: 'none' };
			for (const root of roots) {
				const quality = compare(agent.cwd, root);
				if (RANK[quality] > RANK[best.quality]) {
					best = { agent, quality, matchedRoot: root };
				}
			}
			return best;
		})
		.sort(
			(a, b) => RANK[b.quality] - RANK[a.quality] || a.agent.paneId.localeCompare(b.agent.paneId),
		);
}

function compare(cwd: string | undefined, root: string): MatchQuality {
	if (!cwd) {
		return 'none';
	}
	const a = normalize(cwd);
	const b = normalize(root);
	if (!a || !b) {
		return 'none';
	}
	if (a === b) {
		return 'exact';
	}
	if (a.startsWith(b + '/')) {
		return 'agent-under-root'; // agent started in a subdirectory of the repo
	}
	if (b.startsWith(a + '/')) {
		return 'root-under-agent'; // agent started at a parent, e.g. a monorepo root
	}
	return 'none';
}

function normalize(p: string): string {
	return p.split('\\').join('/').replace(/\/+$/, '');
}

/** True when no agent reports a cwd at all, i.e. herdr is older than 0.7.5. */
export function lacksCwdSupport(agents: readonly HerdrAgent[]): boolean {
	return agents.length > 0 && agents.every(a => a.cwd === undefined);
}
