/** Errors raised by the herdr CLI transport, plus stderr message extraction. */

export class HerdrCliError extends Error {
	constructor(
		readonly argv: readonly string[],
		readonly exitCode: number | null,
		readonly stderrRaw: string,
		message: string,
	) {
		super(message);
		this.name = 'HerdrCliError';
	}
}

export class HerdrNotFoundError extends Error {
	constructor(readonly probed: readonly string[]) {
		super('Could not find the `herdr` binary.');
		this.name = 'HerdrNotFoundError';
	}
}

export class NoAgentsError extends Error {
	constructor(message = 'No herdr agents are running.') {
		super(message);
		this.name = 'NoAgentsError';
	}
}

/** The user dismissed the agent picker. Not a failure — just stop quietly. */
export class TargetCancelledError extends Error {
	constructor() {
		super('Agent selection cancelled.');
		this.name = 'TargetCancelledError';
	}
}

/**
 * herdr emits JSON diagnostics on stderr. Scan lines newest-first for the
 * first parseable object and pull a human message out of it, falling back to
 * the raw text so a plain panic or a linker error is never swallowed.
 */
export function extractCliMessage(stderr: string): string {
	const trimmed = stderr.trim();
	if (!trimmed) {
		return '';
	}
	const lines = trimmed.split('\n').reverse();
	for (const line of lines) {
		const candidate = line.trim();
		if (!candidate.startsWith('{')) {
			continue;
		}
		try {
			const message = pickMessage(JSON.parse(candidate));
			if (message) {
				return message;
			}
		} catch {
			// Not JSON after all; keep scanning.
		}
	}
	return trimmed;
}

function pickMessage(value: unknown): string | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const obj = value as Record<string, unknown>;
	const err = obj['error'] ?? obj['err'];
	if (typeof err === 'string') {
		return err;
	}
	if (typeof err === 'object' && err !== null) {
		const nested = (err as Record<string, unknown>)['message'];
		return typeof nested === 'string' ? nested : JSON.stringify(err);
	}
	if (typeof obj['message'] === 'string') {
		return obj['message'] as string;
	}
	return undefined;
}
