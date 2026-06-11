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
  assert.equal(received[0].io, harness.io);
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
  assert.equal(received[0].io, harness.io);
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

async function testMissingClientModulePrintsActionableError() {
  const harness = createIo({
    clientLoader: async (specifier) => {
      const error = new Error(`Cannot find package '${specifier}'`);
      error.code = 'ERR_MODULE_NOT_FOUND';
      throw error;
    },
  });

  const result = await cli.run(['tui'], harness.io);

  assert.equal(result, 1);
  assert.equal(harness.stdout.join(''), '');
  assert.match(harness.stderr.join(''), /Unable to load bluenote-term for `bluenote tui`\./);
  assert.match(harness.stderr.join(''), /Install the public bluenote-term package/);
  assert.match(harness.stderr.join(''), /public command API/);
}

async function testMissingPublicApiPrintsActionableError() {
  const harness = createIo({
    clientLoader: async () => ({ notACommand: async () => 0 }),
  });

  const result = await cli.run(['web'], harness.io);

  assert.equal(result, 1);
  assert.equal(harness.stdout.join(''), '');
  assert.match(harness.stderr.join(''), /bluenote-webui does not export a supported command API for `bluenote web`\./);
  assert.match(harness.stderr.join(''), /Expected one of: runWebCommand, runCommand/);
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
  await testMissingClientModulePrintsActionableError();
  await testMissingPublicApiPrintsActionableError();
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
