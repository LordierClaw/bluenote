'use strict';

const assert = require('assert').strict;
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const cli = require('../dist/cli.js');
const packageJson = require('../package.json');

function createStream() {
  let text = '';
  return {
    stream: {
      write(chunk) {
        text += String(chunk);
      },
    },
    text() {
      return text;
    },
  };
}

async function runCli(args, extraIo = {}) {
  const stdout = createStream();
  const stderr = createStream();
  const code = await cli.run(args, {
    stdout: stdout.stream,
    stderr: stderr.stream,
    ...extraIo,
  });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

async function testPackageMetadata() {
  assert.equal(packageJson.name, '@lordierclaw/bluenote');
  assert.equal(packageJson.bin.bluenote, './dist/bin.js');
  assert.equal(packageJson.bin.bn, './dist/bin.js');
  for (const script of ['clean', 'build', 'typecheck', 'test', 'check']) {
    assert.ok(packageJson.scripts[script], `missing script ${script}`);
  }
  assert.equal(packageJson.dependencies['@lordierclaw/bluenote-core'], 'file:../bluenote-core');
  assert.equal(packageJson.dependencies['bluenote-term'], 'file:../bluenote-term/packages/term');
  assert.equal(packageJson.dependencies['bluenote-webui'], 'file:../bluenote-webui');
}

async function testHelpDoesNotLoadClients() {
  const result = await runCli(['--help'], {
    clientLoader() {
      throw new Error('client loader should not be called');
    },
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /BlueNote distribution CLI/);
  assert.match(result.stdout, /tui \[\.\.\.args\]/);
  assert.equal(result.stderr, '');
}

async function testVersionDoesNotLoadClients() {
  const result = await runCli(['version'], {
    clientLoader() {
      throw new Error('client loader should not be called');
    },
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /@lordierclaw\/bluenote 0\.0\.0/);
  assert.match(result.stdout, /@lordierclaw\/bluenote-core/);
  assert.match(result.stdout, /bluenote-term/);
  assert.match(result.stdout, /bluenote-webui/);
  assert.equal(result.stderr, '');
}

async function testDoctorDoesNotLoadClients() {
  const result = await runCli(['doctor'], {
    nodeVersion: '16.14.0',
    platform: 'linux',
    spawnSync(command, args) {
      assert.equal(command, 'bun');
      assert.deepEqual(args, ['--version']);
      return { status: 0, stdout: '1.3.14\n' };
    },
    clientLoader() {
      throw new Error('client loader should not be called');
    },
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Node status: ok/);
  assert.match(result.stdout, /Package @lordierclaw\/bluenote-core: ok/);
  assert.match(result.stdout, /Bun for TUI: available/);
}

async function testUnknownCommand() {
  const result = await runCli(['nope']);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Unknown command: nope/);
}

async function testDaemonScaffold() {
  for (const action of ['start', 'status', 'stop']) {
    const result = await runCli(['daemon', action]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, new RegExp(`daemon ${action} is not implemented yet`));
    assert.equal(result.stderr, '');
  }
}

async function testWebLazyApi() {
  const calls = [];
  const result = await runCli(['web', '--port', '5001'], {
    clientLoader: async (specifier) => {
      calls.push(specifier);
      return {
        runWebCommand: async (args, options) => {
          assert.deepEqual(args, ['--port', '5001']);
          assert.ok(options.stdout);
          return 0;
        },
      };
    },
  });
  assert.equal(result.code, 0);
  assert.deepEqual(calls, ['bluenote-webui']);
}

async function testTuiRuntimeError() {
  const result = await runCli(['tui'], {
    spawn() {
      const child = new EventEmitter();
      process.nextTick(() => child.emit('error', new Error('spawn bun ENOENT')));
      return child;
    },
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /requires Bun\/OpenTUI/);
}

async function testBuildOutputExists() {
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'dist', 'bin.js')));
  const bin = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bin.js'), 'utf8');
  assert.ok(bin.startsWith('#!/usr/bin/env node'));
}

const tests = [
  testPackageMetadata,
  testHelpDoesNotLoadClients,
  testVersionDoesNotLoadClients,
  testDoctorDoesNotLoadClients,
  testUnknownCommand,
  testDaemonScaffold,
  testWebLazyApi,
  testTuiRuntimeError,
  testBuildOutputExists,
];

(async () => {
  for (const test of tests) {
    await test();
    process.stdout.write(`PASS ${test.name}\n`);
  }
})().catch((error) => {
  process.stderr.write(error && error.stack ? `${error.stack}\n` : `${error}\n`);
  process.exitCode = 1;
});
