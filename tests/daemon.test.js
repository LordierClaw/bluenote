'use strict';

const assert = require('assert').strict;
const Module = require('module');

function createIo(extra) {
  const stdout = [];
  const stderr = [];

  return {
    stdout,
    stderr,
    io: Object.assign({
      stdout: { write: (chunk) => stdout.push(String(chunk)) },
      stderr: { write: (chunk) => stderr.push(String(chunk)) },
    }, extra || {}),
  };
}

function requireCliWithDaemonIsolationGuards() {
  const cliPath = require.resolve('../src/cli.js');
  delete require.cache[cliPath];

  const originalLoad = Module._load;
  const originalCwd = process.cwd;
  const attemptedForbiddenAccess = [];
  const forbiddenImports = [
    '@lordierclaw/bluenote-core',
    'bluenote-term',
    'bluenote-webui',
    'fs',
    'path',
    'os',
  ];

  Module._load = function guardedLoad(request) {
    if (forbiddenImports.indexOf(request) !== -1) {
      attemptedForbiddenAccess.push(`import:${request}`);
      throw new Error(`daemon scaffold must not import ${request}`);
    }

    return originalLoad.apply(this, arguments);
  };

  process.cwd = function guardedCwd() {
    attemptedForbiddenAccess.push('process.cwd');
    throw new Error('daemon scaffold must not inspect the current workspace');
  };

  try {
    return {
      cli: require('../src/cli.js'),
      attemptedForbiddenAccess,
    };
  } finally {
    Module._load = originalLoad;
    process.cwd = originalCwd;
  }
}

function assertDaemonHelp(help) {
  assert.match(help, /Usage: bluenote daemon \[--help\]/);
  assert.match(help, /scaffold/i);
  assert.match(help, /not implemented/i);
  assert.match(help, /future cross-repo design/i);
  assert.match(help, /daemon\/runtime\/sync protocol/i);
}

async function testDaemonHelpExplainsScaffoldAndSucceeds() {
  const { cli, attemptedForbiddenAccess } = requireCliWithDaemonIsolationGuards();
  const harness = createIo();

  const result = await cli.run(['daemon', '--help'], harness.io);

  assert.equal(result, 0);
  assert.equal(harness.stderr.join(''), '');
  assertDaemonHelp(harness.stdout.join(''));
  assert.deepEqual(attemptedForbiddenAccess, []);
}

async function testDaemonHelpDoesNotLoadClientsCoreOrInspectWorkspace() {
  const { cli, attemptedForbiddenAccess } = requireCliWithDaemonIsolationGuards();
  const loaderCalls = [];
  const harness = createIo({
    clientLoader: async (specifier) => {
      loaderCalls.push(specifier);
      throw new Error(`daemon scaffold must not load ${specifier}`);
    },
  });

  const result = await cli.run(['daemon', '--help'], harness.io);

  assert.equal(result, 0);
  assert.deepEqual(loaderCalls, []);
  assert.deepEqual(attemptedForbiddenAccess, []);
}

async function testDaemonWithoutHelpReturnsClearScaffoldExit() {
  const { cli, attemptedForbiddenAccess } = requireCliWithDaemonIsolationGuards();
  const harness = createIo();

  const result = await cli.run(['daemon'], harness.io);
  const output = `${harness.stdout.join('')}${harness.stderr.join('')}`;

  assert.equal(result, 1);
  assert.match(output, /bluenote daemon/i);
  assert.match(output, /scaffold/i);
  assert.match(output, /not implemented/i);
  assert.match(output, /future cross-repo design/i);
  assert.doesNotMatch(output, /Unknown command:/);
  assert.deepEqual(attemptedForbiddenAccess, []);
}

async function runTests() {
  await testDaemonHelpExplainsScaffoldAndSucceeds();
  await testDaemonHelpDoesNotLoadClientsCoreOrInspectWorkspace();
  await testDaemonWithoutHelpReturnsClearScaffoldExit();
}

runTests()
  .then(() => {
    console.log('daemon.test.js: ok');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
