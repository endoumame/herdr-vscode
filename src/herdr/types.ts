/**
 * Shapes returned by `herdr agent list`.
 *
 * These mirror herdr-reviewr's Rust structs, but the JSON is produced by a
 * separate binary on an independent release cadence, so every field is parsed
 * defensively and unknown fields are ignored.
 */

export interface HerdrAgent {
	/** Narrowed to a non-empty string: entries with a null `agent` are panes, not agents. */
	agent: string;
	agentStatus?: string;
	paneId: string;
	tabId?: string;
	workspaceId?: string;
	/** Present from herdr 0.7.5 onwards. Agent targeting degrades without it. */
	cwd?: string;
	name?: string;
	displayAgent?: string;
	stateLabels: string[];
}

export function parseAgentList(stdout: string): HerdrAgent[] {
	let envelope: unknown;
	try {
		envelope = JSON.parse(stdout);
	} catch {
		throw new Error(`herdr agent list did not return JSON: ${stdout.slice(0, 300)}`);
	}
	const raw = readPath(envelope, ['result', 'agents']);
	if (!Array.isArray(raw)) {
		throw new Error('herdr agent list: missing result.agents');
	}
	return raw.flatMap(entry => parseAgent(entry));
}

function parseAgent(entry: unknown): HerdrAgent[] {
	if (typeof entry !== 'object' || entry === null) {
		return [];
	}
	const obj = entry as Record<string, unknown>;
	const agent = obj['agent'];
	if (typeof agent !== 'string' || agent.length === 0) {
		return []; // a pane without an agent
	}
	const paneId = obj['pane_id'];
	if (paneId === undefined || paneId === null) {
		return [];
	}
	const labels = obj['state_labels'];
	return [
		{
			agent,
			paneId: String(paneId), // may arrive as a number; every use is as a CLI argument
			stateLabels: normalizeStateLabels(labels),
			...optional('agentStatus', str(obj['agent_status'])),
			...optional('tabId', str(obj['tab_id'])),
			...optional('workspaceId', str(obj['workspace_id'])),
			...optional('cwd', str(obj['cwd'])),
			...optional('name', str(obj['name'])),
			...optional('displayAgent', str(obj['display_agent'])),
		},
	];
}

/**
 * `state_labels` is a map in herdr-reviewr's struct but has been seen as an
 * array too; accept either and flatten to display strings.
 */
function normalizeStateLabels(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((v): v is string => typeof v === 'string');
	}
	if (typeof value === 'object' && value !== null) {
		return Object.values(value as Record<string, unknown>).filter(
			(v): v is string => typeof v === 'string',
		);
	}
	return [];
}

function str(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Build a spreadable fragment, so `exactOptionalPropertyTypes` stays happy. */
function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
	return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function readPath(value: unknown, path: readonly string[]): unknown {
	let current = value;
	for (const key of path) {
		if (typeof current !== 'object' || current === null) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}
