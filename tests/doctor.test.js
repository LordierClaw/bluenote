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

async function withCliRuntimeGuards(callback) {
  const cliPath = require.resolve('../src/cli.js');
  delete require.cache[cliPath];
  const doctorPath = require.resolve('../src/commands/doctor.js');
  delete require.cache[doctorPath];

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
      throw new Error(`doctor path must not import ${request}`);
    }

    return originalLoad.apply(this, arguments);
  };

  process.cwd = function guardedCwd() {
    attemptedForbiddenAccess.push('process.cwd');
    throw new Error('doctor path must not inspect the current workspace');
  };

  const cli = require('../src/cli.js');

  try {
    return await callback(cli, attemptedForbiddenAccess);
  } finally {
    Module._load = originalLoad;
    process.cwd = originalCwd;
  }
}

function assertDoctorHeader(output, nodeVersion) {
  assert.match(output, /BlueNote doctor\n/);
  assert.match(output, new RegExp(`Node version: ${nodeVersion.replace(/\./g, '\\.')}\\n`));
  assert.match(output, /Distribution baseline: >=16\.14\n/);
}

async function testSupportedNodeVersionPasses() {
  await withCliRuntimeGuards(async (cli, attemptedForbiddenAccess) => {
    const harness = createIo();

    const result = await cli.run(['doctor'], Object.assign({}, harness.io, { nodeVersion: '16.14.0' }));

    assert.equal(result, 0);
    assert.equal(harness.stderr.join(''), '');
    const output = harness.stdout.join('');
    assertDoctorHeader(output, '16.14.0');
    assert.match(output, /Node baseline: ok\n/);
    assert.deepEqual(attemptedForbiddenAccess, []);
  });
}

async function testNewerNodeVersionPasses() {
  await withCliRuntimeGuards(async (cli) => {
    const harness = createIo();

    const result = await cli.run(['doctor'], Object.assign({}, harness.io, { nodeVersion: '18.0.0' }));

    assert.equal(result, 0);
    assert.equal(harness.stderr.join(''), '');
    assertDoctorHeader(harness.stdout.join(''), '18.0.0');
    assert.match(harness.stdout.join(''), /Node baseline: ok\n/);
  });
}

async function testUnsupportedNodeVersionFails() {
  await withCliRuntimeGuards(async (cli, attemptedForbiddenAccess) => {
    const harness = createIo();

    const result = await cli.run(['doctor'], Object.assign({}, harness.io, { nodeVersion: '16.13.2' }));

    assert.equal(result, 1);
    assert.equal(harness.stderr.join(''), '');
    const output = harness.stdout.join('');
    assertDoctorHeader(output, '16.13.2');
    assert.match(output, /Node baseline: unsupported\n/);
    assert.deepEqual(attemptedForbiddenAccess, []);
  });
}

async function testDoctorUsesProcessNodeVersionByDefault() {
  await withCliRuntimeGuards(async (cli) => {
    const harness = createIo();

    const result = await cli.run(['doctor'], harness.io);

    assert.equal(result, 0);
    assert.equal(harness.stderr.join(''), '');
    assertDoctorHeader(harness.stdout.join(''), process.versions.node);
  });
}

async function runTests() {
  await testSupportedNodeVersionPasses();
  await testNewerNodeVersionPasses();
  await testUnsupportedNodeVersionFails();
  await testDoctorUsesProcessNodeVersionByDefault();
}

runTests()
  .then(() => {
    console.log('doctor.test.js: ok');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
