'use strict';

const assert = require('assert').strict;
const Module = require('module');

function createIo() {
  const stdout = [];
  const stderr = [];

  return {
    stdout,
    stderr,
    io: {
      stdout: { write: (chunk) => stdout.push(String(chunk)) },
      stderr: { write: (chunk) => stderr.push(String(chunk)) },
    },
  };
}

function requireCliWithClientImportGuard() {
  const cliPath = require.resolve('../src/cli.js');
  delete require.cache[cliPath];

  const originalLoad = Module._load;
  const attemptedClientImports = [];

  Module._load = function guardedLoad(request) {
    if (request === 'bluenote-term' || request === 'bluenote-webui') {
      attemptedClientImports.push(request);
      throw new Error(`help path must not import ${request}`);
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    return {
      cli: require('../src/cli.js'),
      attemptedClientImports,
    };
  } finally {
    Module._load = originalLoad;
  }
}

function assertTopLevelHelp(help) {
  assert.match(help, /Usage: bluenote \[command\] \[options\]/);
  assert.match(help, /Commands:/);
  assert.match(help, /\btui\b/);
  assert.match(help, /\bweb\b/);
  assert.match(help, /\bdaemon\b/);
  assert.match(help, /\bdoctor\b/);
  assert.match(help, /\bversion\b/);
}

async function testExplicitHelpListsTopLevelCommands() {
  const { cli } = requireCliWithClientImportGuard();
  const harness = createIo();

  const result = await cli.run(['--help'], harness.io);

  assert.equal(result, 0);
  assert.equal(harness.stderr.join(''), '');
  assertTopLevelHelp(harness.stdout.join(''));
}

async function testNoArgsPrintsTopLevelHelp() {
  const { cli } = requireCliWithClientImportGuard();
  const harness = createIo();

  const result = await cli.run([], harness.io);

  assert.equal(result, 0);
  assert.equal(harness.stderr.join(''), '');
  assertTopLevelHelp(harness.stdout.join(''));
}

async function testUnknownCommandIsConciseAndSuggestsHelp() {
  const { cli } = requireCliWithClientImportGuard();
  const harness = createIo();

  const result = await cli.run(['wat'], harness.io);

  assert.equal(result, 1);
  assert.equal(harness.stdout.join(''), '');
  assert.equal(harness.stderr.join(''), 'Unknown command: wat\nRun "bluenote --help" for usage.\n');
}

async function testHelpDoesNotImportClientPackages() {
  const { cli, attemptedClientImports } = requireCliWithClientImportGuard();
  const harness = createIo();

  const result = await cli.run(['--help'], harness.io);

  assert.equal(result, 0);
  assert.deepEqual(attemptedClientImports, []);
}

async function testKnownCommandsDoNotUseUnknownCommandRoute() {
  const { cli } = requireCliWithClientImportGuard();
  const commands = ['tui', 'web', 'daemon', 'doctor', 'version'];

  for (const command of commands) {
    const harness = createIo();
    const result = await cli.run([command], harness.io);
    const output = `${harness.stdout.join('')}${harness.stderr.join('')}`;

    assert.equal(typeof result, 'number', `${command} should return an exit code`);
    assert.doesNotMatch(output, /Unknown command:/, `${command} should not use the unknown-command route`);
    assert.doesNotMatch(output, /Run "bluenote --help" for usage\./, `${command} should not suggest help as an unknown command`);
  }
}

async function runTests() {
  await testExplicitHelpListsTopLevelCommands();
  await testNoArgsPrintsTopLevelHelp();
  await testUnknownCommandIsConciseAndSuggestsHelp();
  await testHelpDoesNotImportClientPackages();
  await testKnownCommandsDoNotUseUnknownCommandRoute();
}

runTests()
  .then(() => {
    console.log('cli-help.test.js: ok');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
