import * as vscode from 'vscode';

export class Logger {
	private readonly channel = vscode.window.createOutputChannel('herdr Review');

	debug(message: string): void {
		this.channel.appendLine(`[${stamp()}] ${message}`);
	}

	warn(message: string): void {
		this.channel.appendLine(`[${stamp()}] WARN ${message}`);
	}

	error(message: string, err?: unknown): void {
		this.channel.appendLine(`[${stamp()}] ERROR ${message}${err ? `: ${describe(err)}` : ''}`);
	}

	show(): void {
		this.channel.show(true);
	}

	dispose(): void {
		this.channel.dispose();
	}
}

export function describe(err: unknown): string {
	if (err instanceof Error) {
		return err.message;
	}
	return typeof err === 'string' ? err : JSON.stringify(err);
}

function stamp(): string {
	return new Date().toISOString().slice(11, 23);
}
