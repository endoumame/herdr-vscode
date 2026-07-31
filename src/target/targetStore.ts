import * as vscode from 'vscode';

import { getConfig } from '../config.js';
import type { HerdrCli } from '../herdr/cli.js';
import { NoAgentsError, TargetCancelledError } from '../herdr/errors.js';
import type { HerdrAgent } from '../herdr/types.js';
import type { Logger } from '../log.js';
import { collectRoots } from '../util/git.js';
import { lacksCwdSupport, rankOf, scoreAgents, type Candidate } from './agentMatch.js';
import { pickAgent } from './picker.js';

const STORE_KEY = 'herdr.targetAgent';
const CWD_HINT_KEY = 'herdr.shownCwdHint';
const AUTO_HINT_KEY = 'herdr.shownAutoPickHint';
const LIST_TTL_MS = 3000;

interface StoredTarget {
	paneId: string;
	agent: string;
	cwd?: string;
	name?: string;
	displayAgent?: string;
}

export interface ResolveTargetOptions {
	/** Force the picker even when a target is already known. */
	interactive?: boolean;
}

export class TargetStore {
	private cache: { at: number; agents: HerdrAgent[] } | undefined;
	private readonly emitter = new vscode.EventEmitter<void>();

	readonly onDidChange = this.emitter.event;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly cli: HerdrCli,
		private readonly log: Logger,
	) {}

	get current(): StoredTarget | undefined {
		return this.context.workspaceState.get<StoredTarget>(STORE_KEY);
	}

	invalidate(): void {
		this.cache = undefined;
	}

	async listAgents(force = false): Promise<HerdrAgent[]> {
		const now = Date.now();
		if (!force && this.cache && now - this.cache.at < LIST_TTL_MS) {
			return this.cache.agents;
		}
		const agents = await this.cli.agentList();
		this.cache = { at: now, agents };
		return agents;
	}

	/**
	 * Resolve the pane to send to.
	 *
	 * Callers must invoke this *before* building a payload or clearing the
	 * queue: a dead pane or a dismissed picker must never cost the user their
	 * queued comments.
	 */
	async resolve(opts: ResolveTargetOptions = {}): Promise<HerdrAgent> {
		const agents = await this.listAgents(opts.interactive === true);
		if (agents.length === 0) {
			throw new NoAgentsError();
		}

		if (!opts.interactive) {
			const reused = this.reuseStored(agents);
			if (reused) {
				return reused;
			}
		}

		const cfg = getConfig();
		const roots = cfg.agentMatchStrategy === 'cwd' ? await collectRoots() : [];
		let candidates = scoreAgents(agents, roots);
		let matchedWorkspace = true;

		if (cfg.agentMatchStrategy === 'cwd') {
			const matching = candidates.filter(c => rankOf(c.quality) > 0);
			if (matching.length > 0) {
				candidates = matching;
			} else {
				// Not a hard failure: running the agent from a different directory
				// is a legitimate setup.
				matchedWorkspace = false;
				this.maybeHintAboutCwd(agents);
			}
		}

		if (candidates.length === 1 && !opts.interactive) {
			const only = candidates[0]!.agent;
			this.store(only);
			this.announceAutoPick(only);
			return only;
		}

		const picked = await pickAgent(candidates, { matchedWorkspace });
		if (!picked) {
			throw new TargetCancelledError();
		}
		this.store(picked);
		return picked;
	}

	/**
	 * A stored pane id is only good while that pane is alive *and* still hosts
	 * the same agent — herdr can recycle a pane id after a pane dies.
	 */
	private reuseStored(agents: readonly HerdrAgent[]): HerdrAgent | undefined {
		const stored = this.current;
		if (!stored) {
			return undefined;
		}
		const live = agents.find(a => a.paneId === stored.paneId);
		if (live && live.agent === stored.agent) {
			return live;
		}
		this.log.debug(`stored target pane ${stored.paneId} is gone; re-resolving`);
		void this.context.workspaceState.update(STORE_KEY, undefined);
		this.emitter.fire();
		return undefined;
	}

	private store(agent: HerdrAgent): void {
		const stored: StoredTarget = {
			paneId: agent.paneId,
			agent: agent.agent,
			...(agent.cwd === undefined ? {} : { cwd: agent.cwd }),
			...(agent.name === undefined ? {} : { name: agent.name }),
			...(agent.displayAgent === undefined ? {} : { displayAgent: agent.displayAgent }),
		};
		void this.context.workspaceState.update(STORE_KEY, stored);
		this.emitter.fire();
	}

	clear(): void {
		void this.context.workspaceState.update(STORE_KEY, undefined);
		this.emitter.fire();
	}

	/** An automatic choice should not be invisible; say it once per workspace. */
	private announceAutoPick(agent: HerdrAgent): void {
		if (this.context.workspaceState.get<boolean>(AUTO_HINT_KEY)) {
			return;
		}
		void this.context.workspaceState.update(AUTO_HINT_KEY, true);
		void vscode.window.showInformationMessage(
			`herdr: sending to "${label(agent)}"${agent.cwd ? ` in ${agent.cwd}` : ''}. Use "herdr: Select Target Agent" to change it.`,
		);
	}

	private maybeHintAboutCwd(agents: readonly HerdrAgent[]): void {
		if (!lacksCwdSupport(agents) || this.context.globalState.get<boolean>(CWD_HINT_KEY)) {
			return;
		}
		void this.context.globalState.update(CWD_HINT_KEY, true);
		void vscode.window.showInformationMessage(
			'herdr: this herdr build does not report an agent working directory, so the target cannot be matched automatically. herdr 0.7.5 or newer enables it.',
		);
	}

	dispose(): void {
		this.emitter.dispose();
	}
}

export function label(agent: Pick<HerdrAgent, 'agent' | 'displayAgent' | 'name'>): string {
	return agent.displayAgent ?? agent.name ?? agent.agent;
}

export type { Candidate };
