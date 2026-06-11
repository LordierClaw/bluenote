'use strict';

const assert = require('assert').strict;

const cli = require('../src/cli.js');

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

async function testBasicCommandsDoNotCallClientLoader() {
  const calls = [];
  const loader = async (specifier) => {
    calls.push(specifier);
    throw new Error(`unexpected client load: ${specifier}`);
  };

  for (const args of [[], ['--help'], ['version'], ['doctor']]) {
    const harness = createIo({ clientLoader: loader, nodeVersion: '16.14.0' });
    const result = await cli.run(args, harness.io);
    assert.equal(result, 0, `${args.join(' ') || '<empty>'} should succeed`);
  }

  assert.deepEqual(calls, []);
}

async function testTuiLoadsPublicPackageAndPassesArgs() {
  const calls = [];
  const received = [];
  const harness = createIo({
    marker: 'tui-io',
    clientLoader: async (specifier) => {
      calls.push(specifier);
      return {
        runTuiCommand: async (args, io) => {
          received.push({ args, io });
          return 7;
        },
      };
    },
  });

  const result = await cli.run(['tui', '--flag'], harness.io);

  assert.equal(result, 7);
  assert.deepEqual(calls, ['bluenote-term']);
  assert.deepEqual(received.map((entry) => entry.args), [['--flag']]);
  assert.equal(received[0].io.marker, 'tui-io');
  assert.equal(received[0].io.stdout, harness.io.stdout);
  assert.equal(received[0].io.stderr, harness.io.stderr);
  assert.equal(received[0].io.clientLoader, undefined);
}

async function testWebLoadsPublicPackageAndPassesArgs() {
  const calls = [];
  const received = [];
  const harness = createIo({
    marker: 'web-io',
    clientLoader: async (specifier) => {
      calls.push(specifier);
      return {
        runWebCommand: async (args, io) => {
          received.push({ args, io });
          return 0;
        },
      };
    },
  });

  const result = await cli.run(['web', '--port', '4174'], harness.io);

  assert.equal(result, 0);
  assert.deepEqual(calls, ['bluenote-webui']);
  assert.deepEqual(received.map((entry) => entry.args), [['--port', '4174']]);
  assert.equal(received[0].io.marker, 'web-io');
  assert.equal(received[0].io.stdout, harness.io.stdout);
  assert.equal(received[0].io.stderr, harness.io.stderr);
  assert.equal(received[0].io.clientLoader, undefined);
}

async function testRunCommandFallbackIsAccepted() {
  const tuiHarness = createIo({
    clientLoader: async () => ({ runCommand: async () => 3 }),
  });
  const webHarness = createIo({
    clientLoader: async () => ({ runCommand: async () => 4 }),
  });

  assert.equal(await cli.run(['tui'], tuiHarness.io), 3);
  assert.equal(await cli.run(['web'], webHarness.io), 4);
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function testMissingClientModulePrintsActionableError(commandName, packageName, internalPath) {
  const harness = createIo({
    clientLoader: async (specifier) => {
      const error = new Error(`Cannot find package '${specifier}' imported from ${internalPath}`);
      error.code = 'ERR_MODULE_NOT_FOUND';
      throw error;
    },
  });

  const result = await cli.run([commandName], harness.io);
  const stderr = harness.stderr.join('');

  assert.equal(result, 1);
  assert.equal(harness.stdout.join(''), '');
  assert.match(stderr, new RegExp('Unable to load ' + packageName + ' for `bluenote ' + commandName + '`\\.'));
  assert.match(stderr, new RegExp(`Install the public ${packageName} package`));
  assert.match(stderr, /public command API/);
  assert.doesNotMatch(stderr, /Cause:/);
  assert.doesNotMatch(stderr, new RegExp(escapeRegExp(internalPath)));
  assert.doesNotMatch(stderr, /\/root\/code/);
}

async function testMissingPublicApiPrintsActionableError(commandName, packageName, expectedApis) {
  const harness = createIo({
    clientLoader: async () => ({ notACommand: async () => 0 }),
  });

  const result = await cli.run([commandName], harness.io);
  const stderr = harness.stderr.join('');

  assert.equal(result, 1);
  assert.equal(harness.stdout.join(''), '');
  assert.match(stderr, new RegExp(packageName + ' does not export a supported command API for `bluenote ' + commandName + '`\\.'));
  assert.match(stderr, new RegExp(`Expected one of: ${expectedApis.join(', ')}`));
}

async function testClientLoadersUseOnlyPublicPackageSpecifiers() {
  const calls = [];
  const loader = async (specifier) => {
    calls.push(specifier);
    return { runCommand: async () => 0 };
  };

  await cli.run(['tui'], createIo({ clientLoader: loader }).io);
  await cli.run(['web'], createIo({ clientLoader: loader }).io);

  assert.deepEqual(calls, ['bluenote-term', 'bluenote-webui']);
  for (const specifier of calls) {
    assert.doesNotMatch(specifier, /(^|\/)src(\/|$)/);
    assert.doesNotMatch(specifier, /(^|\/)dist(\/|$)/);
    assert.doesNotMatch(specifier, /\.\./);
  }
}

async function runTests() {
  await testBasicCommandsDoNotCallClientLoader();
  await testTuiLoadsPublicPackageAndPassesArgs();
  await testWebLoadsPublicPackageAndPassesArgs();
  await testRunCommandFallbackIsAccepted();
  await testMissingClientModulePrintsActionableError('tui', 'bluenote-term', '/root/code/bluenote/src/commands/tui.js');
  await testMissingClientModulePrintsActionableError('web', 'bluenote-webui', '/root/code/bluenote/src/commands/web.js');
  await testMissingPublicApiPrintsActionableError('tui', 'bluenote-term', ['runTuiCommand', 'runCommand']);
  await testMissingPublicApiPrintsActionableError('web', 'bluenote-webui', ['runWebCommand', 'runCommand']);
  await testClientLoadersUseOnlyPublicPackageSpecifiers();
}

runTests()
  .then(() => {
    console.log('client-wrappers.test.js: ok');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
