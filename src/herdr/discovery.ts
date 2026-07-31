import { execFile } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';

import { HerdrNotFoundError } from './errors.js';
import { expandHome, isExecutable } from '../util/paths.js';

/**
 * Finding the `herdr` binary.
 *
 * VS Code launched from the Dock, Finder or a .desktop entry inherits
 * launchd's or systemd's minimal PATH, which has neither `~/.local/bin` nor
 * `/opt/homebrew/bin` nor `~/.cargo/bin` — the three places herdr is most
 * likely to live.
 */

export const CANDIDATE_DIRS: readonly string[] = [
	'~/.local/bin',
	'~/.cargo/bin',
	'/opt/homebrew/bin',
	'/usr/local/bin',
	'/usr/bin',
	'/bin',
	'~/bin',
	'/home/linuxbrew/.linuxbrew/bin',
];

const BINARY = process.platform === 'win32' ? 'herdr.exe' : 'herdr';

export interface DiscoveryResult {
	binPath: string;
	/** Everything we looked at, for a useful error message. */
	probed: string[];
}

let cached: Promise<DiscoveryResult> | undefined;

export function invalidateDiscoveryCache(): void {
	cached = undefined;
}

export function resolveHerdrBinary(configuredPath: string): Promise<DiscoveryResult> {
	if (!cached) {
		cached = discover(configuredPath).catch(err => {
			cached = undefined; // let the next attempt retry rather than caching a failure
			throw err;
		});
	}
	return cached;
}

async function discover(configuredPath: string): Promise<DiscoveryResult> {
	const probed: string[] = [];

	// 1. Explicit setting wins, and a bad value is an error rather than a
	//    silent fallback — otherwise a typo looks like "herdr isn't installed".
	const configured = configuredPath.trim();
	if (configured) {
		const expanded = expandHome(configured);
		probed.push(expanded);
		if (await isExecutable(expanded)) {
			return { binPath: expanded, probed };
		}
		throw new HerdrNotFoundError(probed);
	}

	// 2. The env var herdr itself uses for plugins.
	const fromEnv = process.env['HERDR_BIN_PATH'];
	if (fromEnv) {
		const expanded = expandHome(fromEnv);
		probed.push(expanded);
		if (await isExecutable(expanded)) {
			return { binPath: expanded, probed };
		}
	}

	// 3. Scan the inherited PATH by hand. Relying on execFile('herdr')
	//    succeeding would conflate "not installed" with "installed but failing".
	for (const dir of (process.env['PATH'] ?? '').split(path.delimiter)) {
		if (!dir) {
			continue;
		}
		const candidate = path.join(dir, BINARY);
		probed.push(candidate);
		if (await isExecutable(candidate)) {
			return { binPath: candidate, probed };
		}
	}

	// 4. The usual install locations a GUI launch would have missed.
	for (const dir of CANDIDATE_DIRS) {
		const candidate = path.join(expandHome(dir), BINARY);
		probed.push(candidate);
		if (await isExecutable(candidate)) {
			return { binPath: candidate, probed };
		}
	}

	// 5. Last resort: ask the user's login shell.
	const fromShell = await probeLoginShell();
	if (fromShell) {
		probed.push(fromShell);
		return { binPath: fromShell, probed };
	}

	throw new HerdrNotFoundError(probed);
}

/**
 * The only place this extension invokes a shell. The command string is a
 * constant with no interpolation. `-i` is tried second because interactive rc
 * files can be slow or write prompts to stdout.
 */
async function probeLoginShell(): Promise<string | undefined> {
	if (process.platform === 'win32') {
		return undefined;
	}
	const shell = process.env['SHELL'] ?? '/bin/bash';
	for (const flags of [
		['-l', '-c'],
		['-l', '-i', '-c'],
	]) {
		const stdout = await runQuiet(shell, [...flags, 'command -v herdr'], 4000);
		if (stdout === undefined) {
			continue;
		}
		const first = stdout
			.split('\n')
			.map(s => s.trim())
			.find(s => s.startsWith('/'));
		if (first && (await isExecutable(first))) {
			return first;
		}
	}
	return undefined;
}

function runQuiet(file: string, args: string[], timeout: number): Promise<string | undefined> {
	return new Promise(resolve => {
		execFile(
			file,
			args,
			{ timeout, encoding: 'utf8', windowsHide: true, env: process.env },
			(err, stdout) => resolve(err ? undefined : stdout),
		);
	});
}

/** Directories to prepend to the child's PATH, since herdr may shell out itself. */
export function extraPathDirs(): string[] {
	return CANDIDATE_DIRS.map(expandHome).filter(dir => dir !== os.homedir());
}
