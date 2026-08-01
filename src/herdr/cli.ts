import { execFile } from 'node:child_process';
import * as path from 'node:path';

import { HerdrCliError, HerdrNotFoundError, extractCliMessage } from './errors.js';
import { forLog, withTrailingNewline, wrapBracketedPaste } from './paste.js';
import { extraPathDirs, resolveHerdrBinary } from './discovery.js';
import { parseAgentList, type HerdrAgent } from './types.js';
import { expandHome } from '../util/paths.js';

export interface CliSettings {
	binPath: string;
	session: string;
	socketPath: string;
	extraArgs: readonly string[];
	commandTimeoutMs: number;
	bracketedPaste: 'always' | 'never';
}

export interface CliLogger {
	debug(message: string): void;
	warn(message: string): void;
}

interface RunResult {
	stdout: string;
	stderr: string;
}

export class HerdrCli {
	constructor(
		private readonly settings: () => CliSettings,
		private readonly log: CliLogger,
	) {}

	async agentList(): Promise<HerdrAgent[]> {
		const { stdout } = await this.exec(['agent', 'list']);
		return parseAgentList(stdout);
	}

	async paneSendText(paneId: string, text: string): Promise<void> {
		const cfg = this.settings();
		// Inside the markers, so the terminal takes it as a newline rather than
		// as the Enter this extension promises never to press.
		const body = withTrailingNewline(text);
		const payload = cfg.bracketedPaste === 'always' ? wrapBracketedPaste(body) : body;
		this.log.debug(
			`pane send-text ${paneId} (${Buffer.byteLength(payload, 'utf8')} bytes)\n${forLog(payload)}`,
		);
		await this.exec(['pane', 'send-text', paneId, payload]);
	}

	async agentFocus(paneId: string): Promise<void> {
		await this.exec(['agent', 'focus', paneId]);
	}

	private async exec(subcommand: readonly string[]): Promise<RunResult> {
		const cfg = this.settings();
		const { binPath, probed } = await resolveHerdrBinary(cfg.binPath);
		const args = [...cfg.extraArgs, ...subcommand];
		try {
			return await run(binPath, args, cfg.commandTimeoutMs, buildEnv(cfg));
		} catch (err) {
			if (err instanceof HerdrNotFoundError) {
				throw new HerdrNotFoundError(probed);
			}
			throw err;
		}
	}
}

function run(
	file: string,
	args: readonly string[],
	timeout: number,
	env: NodeJS.ProcessEnv,
): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		execFile(
			file,
			[...args],
			{
				// Never `shell: true`. The arguments carry ESC bytes and arbitrary
				// review prose; a shell would reinterpret quotes, $, backticks and
				// newlines. execFile hands argv straight to execve.
				shell: false,
				timeout,
				killSignal: 'SIGKILL',
				maxBuffer: 8 * 1024 * 1024,
				windowsHide: true,
				encoding: 'utf8',
				env,
			},
			(err, stdout, stderr) => {
				if (!err) {
					resolve({ stdout, stderr });
					return;
				}
				const e = err as NodeJS.ErrnoException & { killed?: boolean };
				if (e.code === 'ENOENT') {
					reject(new HerdrNotFoundError([file]));
					return;
				}
				const detail = e.killed
					? `herdr timed out after ${timeout}ms`
					: extractCliMessage(stderr) || e.message;
				reject(
					new HerdrCliError(
						[file, ...args],
						typeof e.code === 'number' ? e.code : null,
						stderr,
						detail,
					),
				);
			},
		);
	});
}

/**
 * Socket selection goes through environment variables rather than the
 * `--session` flag: `HERDR_SESSION` is position-independent, whereas a global
 * flag has to precede the subcommand and its exact placement is a
 * compatibility risk across herdr versions. `herdr.extraArgs` is the escape
 * hatch for anyone who needs the flag.
 */
function buildEnv(cfg: CliSettings): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	if (cfg.socketPath.trim()) {
		env['HERDR_SOCKET_PATH'] = expandHome(cfg.socketPath.trim());
	}
	if (cfg.session.trim()) {
		env['HERDR_SESSION'] = cfg.session.trim();
	}
	const parts = [...extraPathDirs(), ...(env['PATH'] ?? '').split(path.delimiter)];
	env['PATH'] = [...new Set(parts.filter(Boolean))].join(path.delimiter);
	return env;
}
