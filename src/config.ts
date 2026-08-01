import * as vscode from 'vscode';

import { CONFIG_SECTION, createConfigReader, type HerdrConfig } from './configSource.js';

export type { HerdrConfig };

const reader = createConfigReader(() => vscode.workspace.getConfiguration(CONFIG_SECTION));

/**
 * The current settings snapshot. Cheap enough to call from a hot path — it is
 * one map lookup until `invalidateConfig` runs.
 */
export function getConfig(): HerdrConfig {
	return reader.get();
}

/**
 * Drop the snapshot. Idempotent, so a listener that needs fresh settings can
 * call it defensively rather than depending on the order VS Code happens to
 * dispatch `onDidChangeConfiguration` listeners in.
 */
export function invalidateConfig(): void {
	reader.invalidate();
}

export function watchConfig(): vscode.Disposable {
	return vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration(CONFIG_SECTION)) {
			reader.invalidate();
		}
	});
}
