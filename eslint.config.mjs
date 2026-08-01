import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

/**
 * The pure modules must never import `vscode`. They are the ones covered by
 * `node --test`, and a stray import would make them unloadable outside the
 * extension host.
 */
const PURE_MODULES = [
	'src/herdr/paste.ts',
	'src/herdr/types.ts',
	'src/herdr/errors.ts',
	'src/target/agentMatch.ts',
	'src/review/location.ts',
	'src/review/snippet.ts',
	'src/review/export.ts',
	'src/review/threadContext.ts',
];

export default [
	{
		files: ['src/**/*.ts', 'test/**/*.ts'],
		languageOptions: {
			parser: tsparser,
			ecmaVersion: 2022,
			sourceType: 'module',
		},
		plugins: { '@typescript-eslint': tseslint },
		rules: {
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
			eqeqeq: ['error', 'always', { null: 'ignore' }],
			'no-throw-literal': 'error',
		},
	},
	{
		files: PURE_MODULES,
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: 'vscode',
							message:
								'This module must stay pure so it can run under `node --test`. Move VS Code API usage to an adapter.',
						},
					],
				},
			],
		},
	},
];
