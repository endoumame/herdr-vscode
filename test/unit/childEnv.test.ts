import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { composeChildPath } from '../../src/herdr/cli.js';
import { CANDIDATE_DIRS, extraPathDirs } from '../../src/herdr/discovery.js';

const SEP = path.delimiter;

test('extraPathDirs expands every candidate directory', () => {
	const dirs = extraPathDirs();
	assert.equal(dirs.length > 0, true);
	assert.equal(
		dirs.some(dir => dir.startsWith('~')),
		false,
		'a tilde would be passed to the child verbatim',
	);
	assert.equal(dirs.includes(path.join(os.homedir(), '.local/bin')), true);
	assert.equal(dirs.length <= CANDIDATE_DIRS.length, true);
});

test('extraPathDirs never offers the bare home directory', () => {
	assert.equal(extraPathDirs().includes(os.homedir()), false);
});

test('extraPathDirs is computed once, not per CLI invocation', () => {
	// os.homedir() plus eight path joins on every `herdr` call is pure waste;
	// the candidate list is a module constant.
	assert.equal(extraPathDirs(), extraPathDirs());
});

test('composeChildPath puts the candidate directories in front of the inherited PATH', () => {
	const out = composeChildPath(['/opt/herdr/bin'], `/usr/bin${SEP}/bin`);
	assert.equal(out, ['/opt/herdr/bin', '/usr/bin', '/bin'].join(SEP));
});

test('composeChildPath drops duplicates, keeping the first occurrence', () => {
	const out = composeChildPath(['/usr/bin', '/opt/bin'], `/usr/bin${SEP}/bin${SEP}/opt/bin`);
	assert.equal(out, ['/usr/bin', '/opt/bin', '/bin'].join(SEP));
});

test('composeChildPath drops the empty entries an inherited PATH picks up', () => {
	const out = composeChildPath(['/opt/bin'], `${SEP}/usr/bin${SEP}${SEP}`);
	assert.equal(out, ['/opt/bin', '/usr/bin'].join(SEP));
});

test('composeChildPath copes with an empty inherited PATH', () => {
	assert.equal(composeChildPath(['/opt/bin'], ''), '/opt/bin');
	assert.equal(composeChildPath([], ''), '');
});

test('composeChildPath returns the identical string for a repeated inherited PATH', () => {
	// Called on every herdr invocation with a PATH that does not change.
	const inherited = `/usr/bin${SEP}/bin`;
	assert.equal(composeChildPath(extraPathDirs(), inherited), composeChildPath(extraPathDirs(), inherited));
});
