'use strict';

const assert = require('assert').strict;
const Module = require('module');
const packageJson = require('../package.json');

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

function requireCliWithIsolationGuards() {
  const cliPath = require.resolve('../src/cli.js');
  delete require.cache[cliPath];

  const originalLoad = Module._load;
  const originalCwd = process.cwd;
  const attemptedForbiddenAccess = [];
  const forbiddenImports = [
    '@lordierclaw/bluenote-core',
    'bluenote-term',
    'bluenote-webui',
    'os',
  ];

  Module._load = function guardedLoad(request) {
    if (forbiddenImports.indexOf(request) !== -1) {
      attemptedForbiddenAccess.push(`import:${request}`);
      throw new Error(`version path must not import ${request}`);
    }

    return originalLoad.apply(this, arguments);
  };

  process.cwd = function guardedCwd() {
    attemptedForbiddenAccess.push('process.cwd');
    throw new Error('version path must not inspect the current workspace');
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

async function testVersionPrintsDistributionPackageVersion() {
  const { cli, attemptedForbiddenAccess } = requireCliWithIsolationGuards();
  const harness = createIo();

  const result = await cli.run(['version'], harness.io);

  assert.equal(result, 0);
  assert.equal(harness.stdout.join(''), `${packageJson.version}\n`);
  assert.equal(harness.stderr.join(''), '');
  assert.deepEqual(attemptedForbiddenAccess, []);
}

async function runTests() {
  await testVersionPrintsDistributionPackageVersion();
}

runTests()
  .then(() => {
    console.log('version.test.js: ok');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
