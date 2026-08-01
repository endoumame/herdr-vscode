import { toPosix } from '../util/text.js';

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
	// Normalised once for the whole scan rather than once per agent, and paired
	// with the original so `matchedRoot` still reports what the caller passed in.
	const normalizedRoots: { readonly raw: string; readonly normalized: string }[] = [];
	for (const raw of roots) {
		const normalized = normalize(raw);
		if (normalized) {
			normalizedRoots.push({ raw, normalized });
		}
	}

	return agents
		.map(agent => {
			let best: Candidate = { agent, quality: 'none' };
			const cwd = agent.cwd ? normalize(agent.cwd) : '';
			if (!cwd) {
				return best;
			}
			for (const root of normalizedRoots) {
				const quality = compare(cwd, root.normalized);
				if (RANK[quality] > RANK[best.quality]) {
					best = { agent, quality, matchedRoot: root.raw };
				}
			}
			return best;
		})
		.sort(
			(a, b) => RANK[b.quality] - RANK[a.quality] || a.agent.paneId.localeCompare(b.agent.paneId),
		);
}

/** Both arguments are already normalised and non-empty. */
function compare(cwd: string, root: string): MatchQuality {
	if (cwd === root) {
		return 'exact';
	}
	if (cwd.startsWith(root + '/')) {
		return 'agent-under-root'; // agent started in a subdirectory of the repo
	}
	if (root.startsWith(cwd + '/')) {
		return 'root-under-agent'; // agent started at a parent, e.g. a monorepo root
	}
	return 'none';
}

function normalize(p: string): string {
	const posix = toPosix(p);
	let end = posix.length;
	while (end > 0 && posix.charCodeAt(end - 1) === 47) {
		end--;
	}
	return end === posix.length ? posix : posix.slice(0, end);
}

/** True when no agent reports a cwd at all, i.e. herdr is older than 0.7.5. */
export function lacksCwdSupport(agents: readonly HerdrAgent[]): boolean {
	return agents.length > 0 && agents.every(a => a.cwd === undefined);
}
