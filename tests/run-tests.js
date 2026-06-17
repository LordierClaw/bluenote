'use strict';

const assert = require('assert').strict;
const childProcess = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const cli = require('../dist/cli.js');
const { findCommandOnPath } = require('../dist/utils/command-discovery.js');
const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');

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

function makeTempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `bluenote-${name}-`));
}

function writeExecutable(filePath, content = '#!/usr/bin/env node\nprocess.exit(0)\n') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, 0o755);
}

function makeDaemonEnv() {
  const root = makeTempDir('daemon-env');
  const env = {
    ...process.env,
    BLUENOTE_CONFIG_HOME: path.join(root, 'config'),
    BLUENOTE_DATA_HOME: path.join(root, 'data'),
    BLUENOTE_CACHE_HOME: path.join(root, 'cache'),
  };
  delete env.BLUENOTE_DAEMON_STATE;
  return {
    root,
    env,
  };
}

function writeDaemonMetadata(env, metadata) {
  const stateDir = path.join(env.BLUENOTE_CONFIG_HOME, 'bluenote');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'daemon.json'), JSON.stringify(metadata, null, 2));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function writePackageJson(workspaceRoot, repoName, packageData) {
  const packageDir = path.join(workspaceRoot, repoName);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify(packageData, null, 2));
}

function writeVersionStatusFixture(overrides = {}) {
  const workspaceRoot = makeTempDir('version-status');
  const packages = {
    bluenote: {
      name: '@lordierclaw/bluenote',
      version: '0.1.0',
      dependencies: {
        '@lordierclaw/bluenote-core': 'git+https://github.com/LordierClaw/bluenote-core.git#0123456789abcdef0123456789abcdef01234567',
      },
    },
    'bluenote-core': { name: '@lordierclaw/bluenote-core', version: '0.1.0' },
    'bluenote-webui': { name: '@lordierclaw/bluenote-webui', version: '0.1.0' },
    'bluenote-term': { name: '@lordierclaw/bluenote-term', version: '0.1.0' },
  };

  for (const [repoName, packageData] of Object.entries(packages)) {
    const packageRepoName = repoName === 'bluenote-term' ? path.join(repoName, 'packages', 'term') : repoName;
    writePackageJson(workspaceRoot, packageRepoName, {
      ...packageData,
      ...(overrides[repoName] || {}),
    });
  }

  return workspaceRoot;
}

function runVersionStatus(args = [], options = {}) {
  return childProcess.spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'version-status.mjs'), ...args], {
    cwd: options.cwd || path.join(__dirname, '..'),
    encoding: 'utf8',
  });
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error('request timed out')));
  });
}

function httpPost(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: 'POST', headers }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error('request timed out')));
    request.end();
  });
}

async function httpGetJson(url, headers = {}) {
  const response = await httpGet(url, headers);
  return { status: response.status, json: JSON.parse(response.body) };
}

async function testPackageMetadata() {
  assert.equal(packageJson.name, '@lordierclaw/bluenote');
  assert.equal(packageJson.version, '0.1.0');
  assert.deepEqual(packageJson.files, ['dist', 'README.md', 'LICENSE', 'package.json']);
  assert.equal(packageLock.name, packageJson.name);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].name, packageJson.name);
  assert.equal(packageLock.packages[''].version, packageJson.version);
  assert.equal(packageJson.bin.bluenote, './dist/bin.js');
  assert.equal(packageJson.bin.bn, './dist/bin.js');
  for (const script of ['clean', 'build', 'typecheck', 'test', 'check']) {
    assert.ok(packageJson.scripts[script], `missing script ${script}`);
  }
  assert.match(packageJson.dependencies['@lordierclaw/bluenote-core'], /^git\+https:\/\/github\.com\/LordierClaw\/bluenote-core\.git#[0-9a-f]{40}$/);
  assert.equal(packageJson.dependencies['bluenote-term'], undefined);
  assert.equal(packageJson.dependencies['bluenote-webui'], undefined);
}

async function testVersionStatusScript() {
  const workspaceRoot = writeVersionStatusFixture();

  const strictResult = runVersionStatus(['--workspace-root', workspaceRoot]);
  assert.notEqual(strictResult.status, 0);
  assert.match(strictResult.stderr, /Git dependency is not allowed in release mode/);

  const result = runVersionStatus(['--workspace-root', workspaceRoot, '--allow-git-deps']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /BlueNote package versions/);
  assert.match(result.stdout, /@lordierclaw\/bluenote\s+0\.1\.0/);
  assert.match(result.stdout, /@lordierclaw\/bluenote-core\s+0\.1\.0/);
  assert.match(result.stdout, /@lordierclaw\/bluenote-webui\s+0\.1\.0/);
  assert.match(result.stdout, /@lordierclaw\/bluenote-term\s+0\.1\.0/);
  assert.equal(result.stderr, '');
}

async function testVersionStatusScriptFailures() {
  const badNameRoot = writeVersionStatusFixture({
    'bluenote-webui': { name: 'bluenote-webui' },
  });
  const badName = runVersionStatus(['--workspace-root', badNameRoot, '--allow-git-deps']);
  assert.notEqual(badName.status, 0);
  assert.match(badName.stderr, /expected @lordierclaw\/bluenote-webui/);

  const badVersionRoot = writeVersionStatusFixture({
    'bluenote-term': { version: 'not-semver' },
  });
  const badVersion = runVersionStatus(['--workspace-root', badVersionRoot, '--allow-git-deps']);
  assert.notEqual(badVersion.status, 0);
  assert.match(badVersion.stderr, /invalid semver version/);

  const leadingZeroRoot = writeVersionStatusFixture({
    'bluenote-core': { version: '01.2.3' },
  });
  const leadingZero = runVersionStatus(['--workspace-root', leadingZeroRoot, '--allow-git-deps']);
  assert.notEqual(leadingZero.status, 0);
  assert.match(leadingZero.stderr, /invalid semver version/);

  const emptyPrereleaseRoot = writeVersionStatusFixture({
    'bluenote': { version: '1.2.3-alpha..1' },
  });
  const emptyPrerelease = runVersionStatus(['--workspace-root', emptyPrereleaseRoot, '--allow-git-deps']);
  assert.notEqual(emptyPrerelease.status, 0);
  assert.match(emptyPrerelease.stderr, /invalid semver version/);

  const missingRoot = writeVersionStatusFixture();
  fs.rmSync(path.join(missingRoot, 'bluenote-core'), { recursive: true, force: true });
  const missingPackage = runVersionStatus(['--workspace-root', missingRoot, '--allow-git-deps']);
  assert.notEqual(missingPackage.status, 0);
  assert.match(missingPackage.stderr, /missing package/);
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
  assert.match(result.stdout, new RegExp(`${escapeRegExp(packageJson.name)} ${escapeRegExp(packageJson.version)}`));
  assert.match(result.stdout, /@lordierclaw\/bluenote-core/);
  assert.doesNotMatch(result.stdout, /bluenote-term/);
  assert.doesNotMatch(result.stdout, /bluenote-webui/);
  assert.equal(result.stderr, '');
}

async function testDoctorDoesNotLoadClients() {
  const result = await runCli(['doctor'], {
    nodeVersion: '16.14.0',
    platform: 'linux',
    env: { ...process.env, PATH: '' },
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
  assert.match(result.stdout, /Distribution/);
  assert.match(result.stdout, /Clients/);
  assert.match(result.stdout, /Config/);
  assert.match(result.stdout, /Bun for TUI: available/);
}

async function testCommandDiscovery() {
  const tempBin = makeTempDir('path-bin');
  const webPath = path.join(tempBin, 'bluenote-webui');
  writeExecutable(webPath);

  assert.deepEqual(findCommandOnPath('bluenote-webui', { path: tempBin, platform: 'linux' }), {
    command: 'bluenote-webui',
    path: webPath,
  });
  const nonExecutablePath = path.join(tempBin, 'bluenote-term');
  fs.writeFileSync(nonExecutablePath, '#!/usr/bin/env node\nprocess.exit(0)\n');
  fs.chmodSync(nonExecutablePath, 0o644);
  assert.equal(findCommandOnPath('bluenote-term', { path: tempBin, platform: 'linux' }), undefined);
  assert.equal(findCommandOnPath('missing-client', { path: tempBin, platform: 'linux' }), undefined);

  const winBin = makeTempDir('path-win-bin');
  const winPath = path.join(winBin, 'bluenote-webui.CMD');
  writeExecutable(winPath);
  assert.deepEqual(findCommandOnPath('bluenote-webui', {
    path: winBin,
    platform: 'win32',
    pathext: '.COM;.EXE;.BAT;.CMD',
  }), {
    command: 'bluenote-webui',
    path: winPath,
  });

  assert.equal(findCommandOnPath('node', { path: tempBin, platform: 'linux' }), undefined);
}

async function testDoctorReportsOptionalClients() {
  const noClients = await runCli(['doctor'], {
    nodeVersion: '18.19.0',
    platform: 'linux',
    env: { ...process.env, PATH: '', BLUENOTE_DAEMON_TOKEN: 'do-not-print-this' },
    spawnSync: () => ({ status: 1, stdout: '', stderr: '' }),
  });
  assert.equal(noClients.code, 0);
  assert.match(noClients.stdout, /bluenote-webui: missing/);
  assert.match(noClients.stdout, /bluenote-term: missing/);
  assert.match(noClients.stdout, /Bun for TUI: not found/);
  assert.doesNotMatch(noClients.stdout, /do-not-print-this|BLUENOTE_DAEMON_TOKEN/);

  const tempBin = makeTempDir('doctor-clients');
  const webPath = path.join(tempBin, 'bluenote-webui');
  const termPath = path.join(tempBin, 'bluenote-term');
  writeExecutable(webPath);
  writeExecutable(termPath);
  const found = await runCli(['doctor'], {
    nodeVersion: '18.19.0',
    platform: 'linux',
    env: { ...process.env, PATH: tempBin },
    spawnSync: () => ({ status: 0, stdout: '1.3.14\n' }),
  });
  assert.equal(found.code, 0);
  assert.match(found.stdout, /bluenote-webui: found/);
  assert.match(found.stdout, new RegExp(escapeRegExp(webPath)));
  assert.match(found.stdout, /version: 1\.3\.14/);
  assert.match(found.stdout, /bluenote-term: found/);
  assert.match(found.stdout, new RegExp(escapeRegExp(termPath)));
}

async function testDoctorReportsBrokenClients() {
  const tempBin = makeTempDir('doctor-broken-clients');
  const webPath = path.join(tempBin, 'bluenote-webui');
  writeExecutable(webPath);
  const found = await runCli(['doctor'], {
    nodeVersion: '18.19.0',
    platform: 'linux',
    env: { ...process.env, PATH: tempBin },
    spawnSync(command) {
      if (command === 'bun') return { status: 1, stdout: '', stderr: '' };
      return { status: 1, stdout: '', stderr: 'broken client' };
    },
  });
  assert.equal(found.code, 0);
  assert.match(found.stdout, /bluenote-webui: broken/);
  assert.match(found.stdout, /version: unavailable/);
}

async function testUnknownCommand() {
  const result = await runCli(['nope']);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Unknown command: nope/);
}

async function testDaemonLifecycle() {
  const { root, env } = makeDaemonEnv();
  try {
    const stopped = await runCli(['daemon', 'status'], { env });
    assert.equal(stopped.code, 0);
    assert.match(stopped.stdout, /status: stopped/);

    const started = await runCli(['daemon', 'start'], { env });
    assert.equal(started.code, 0);
    assert.match(started.stdout, /BlueNote daemon started/);
    assert.match(started.stdout, /endpoint: http:\/\/127\.0\.0\.1:\d+/);
    assert.doesNotMatch(started.stdout, /token/i);

    const metadataPath = path.join(env.BLUENOTE_CONFIG_HOME, 'bluenote', 'daemon.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    assert.ok(metadata.pid);
    assert.ok(metadata.url);
    assert.ok(metadata.token);
    assert.equal(fs.statSync(metadataPath).mode & 0o777, 0o600);

    const running = await runCli(['daemon', 'status'], { env });
    assert.equal(running.code, 0);
    assert.match(running.stdout, /status: running/);
    assert.match(running.stdout, /health: ok/);
    assert.doesNotMatch(running.stdout, new RegExp(metadata.token));

    const doctor = await runCli(['doctor'], { env, nodeVersion: '18.19.0', platform: 'linux', spawnSync: () => ({ status: 1 }) });
    assert.equal(doctor.code, 0);
    assert.match(doctor.stdout, /Daemon/);
    assert.match(doctor.stdout, /status: running/);
    assert.match(doctor.stdout, /token: present/);
    assert.doesNotMatch(doctor.stdout, new RegExp(metadata.token));

    const stoppedAfter = await runCli(['daemon', 'stop'], { env });
    assert.equal(stoppedAfter.code, 0);
    assert.match(stoppedAfter.stdout, /BlueNote daemon stopped/);

    const finalStatus = await runCli(['daemon', 'status'], { env });
    assert.equal(finalStatus.code, 0);
    assert.match(finalStatus.stdout, /status: stopped/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testDaemonStartDoesNotExposeTokenInArgv() {
  const { root, env } = makeDaemonEnv();
  try {
    const spawned = [];
    function spawn(command, args, options) {
      spawned.push({ command, args, options });
      const child = new EventEmitter();
      child.pid = 99999999;
      child.unref = () => {};
      return child;
    }
    const result = await runCli(['daemon', 'start'], { env, spawn });
    assert.equal(result.code, 1);
    assert.equal(spawned.length, 1);
    assert.deepEqual(spawned[0].args.filter((arg) => arg === '--token'), []);
    assert.ok(spawned[0].options.env.BLUENOTE_DAEMON_SERVE_TOKEN);
    assert.doesNotMatch(spawned[0].args.join(' '), new RegExp(spawned[0].options.env.BLUENOTE_DAEMON_SERVE_TOKEN));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testStaleDaemonMetadata() {
  const { root, env } = makeDaemonEnv();
  try {
    writeDaemonMetadata(env, {
      pid: 99999999,
      url: 'http://127.0.0.1:9',
      token: 'stale-token-not-printed',
      startedAt: new Date().toISOString(),
      version: '0.0.0',
    });
    const result = await runCli(['daemon', 'status'], { env });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /status: stale|status: unreachable/);
    assert.doesNotMatch(result.stdout, /stale-token-not-printed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testClientLaunchRequiresDaemon() {
  for (const command of ['web', 'tui']) {
    const result = await runCli([command], { env: { ...process.env, PATH: '' } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /BlueNote daemon is not running/);
    assert.match(result.stderr, /Run: bluenote daemon start/);
  }
}

async function testClientLaunchUsesPathAndDaemonEnv() {
  const tempBin = makeTempDir('client-launch');
  const { root, env } = makeDaemonEnv();
  try {
    const webPath = path.join(tempBin, 'bluenote-webui');
    const termPath = path.join(tempBin, 'bluenote-term');
    writeExecutable(webPath);
    writeExecutable(termPath);
    const started = await runCli(['daemon', 'start'], { env });
    assert.equal(started.code, 0);
    const metadata = JSON.parse(fs.readFileSync(path.join(env.BLUENOTE_CONFIG_HOME, 'bluenote', 'daemon.json'), 'utf8'));
    const calls = [];
    function spawn(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      process.nextTick(() => child.emit('exit', 0));
      return child;
    }

    const web = await runCli(['web', '--smoke'], { env: { ...env, PATH: tempBin }, spawn });
    assert.equal(web.code, 0);
    const tui = await runCli(['tui', '--smoke'], { env: { ...env, PATH: tempBin }, spawn });
    assert.equal(tui.code, 0);

    assert.equal(calls[0].command, webPath);
    assert.deepEqual(calls[0].args, ['--smoke']);
    assert.equal(calls[0].options.env.BLUENOTE_DAEMON_URL, metadata.url);
    assert.equal(calls[0].options.env.BLUENOTE_DAEMON_TOKEN, metadata.token);
    assert.equal(calls[1].command, termPath);
    assert.deepEqual(calls[1].args, ['--smoke']);
    assert.equal(calls[1].options.env.BLUENOTE_DAEMON_URL, metadata.url);
    assert.equal(calls[1].options.env.BLUENOTE_DAEMON_TOKEN, metadata.token);
    assert.doesNotMatch(web.stdout + web.stderr + tui.stdout + tui.stderr, new RegExp(metadata.token));
  } finally {
    await runCli(['daemon', 'stop'], { env });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testClientLaunchRejectsStaleDaemonMetadataBeforeSpawning() {
  const tempBin = makeTempDir('client-stale-launch');
  const { root, env } = makeDaemonEnv();
  try {
    writeExecutable(path.join(tempBin, 'bluenote-webui'));
    writeDaemonMetadata(env, {
      pid: 99999999,
      url: 'http://127.0.0.1:9',
      token: 'stale-launch-token',
      startedAt: new Date().toISOString(),
      version: '0.0.0',
    });
    let spawnCalled = false;
    const result = await runCli(['web'], {
      env: { ...env, PATH: tempBin },
      spawn() {
        spawnCalled = true;
        throw new Error('should not spawn stale daemon client');
      },
    });
    assert.equal(result.code, 1);
    assert.equal(spawnCalled, false);
    assert.match(result.stderr, /BlueNote daemon is not running/);
    assert.doesNotMatch(result.stderr, /stale-launch-token/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testWindowsClientLaunchUsesShellForCmdShims() {
  const tempBin = makeTempDir('client-win-launch');
  const { root, env } = makeDaemonEnv();
  try {
    const webPath = path.join(tempBin, 'bluenote-webui.CMD');
    writeExecutable(webPath);
    const started = await runCli(['daemon', 'start'], { env });
    assert.equal(started.code, 0);
    const calls = [];
    function spawn(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      process.nextTick(() => child.emit('exit', 0));
      return child;
    }
    const result = await runCli(['web'], { env: { ...env, PATH: tempBin, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, platform: 'win32', spawn });
    assert.equal(result.code, 0);
    assert.equal(calls[0].command, webPath);
    assert.equal(calls[0].options.shell, true);
  } finally {
    await runCli(['daemon', 'stop'], { env });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testMissingClientMessage() {
  const { root, env } = makeDaemonEnv();
  try {
    const started = await runCli(['daemon', 'start'], { env });
    assert.equal(started.code, 0);
    const result = await runCli(['web'], { env: { ...env, PATH: '' } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Optional client bluenote-webui was not found on PATH/);
    assert.doesNotMatch(result.stderr, /missing-client-token/);
  } finally {
    await runCli(['daemon', 'stop'], { env });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testDaemonHealthAndCapabilities() {
  const { root, env } = makeDaemonEnv();
  try {
    const started = await runCli(['daemon', 'start'], { env });
    assert.equal(started.code, 0);
    const metadata = JSON.parse(fs.readFileSync(path.join(env.BLUENOTE_CONFIG_HOME, 'bluenote', 'daemon.json'), 'utf8'));
    const health = await httpGetJson(`${metadata.url}/health`);
    assert.deepEqual(health.json, { ok: true, name: 'bluenote-daemon', version: packageJson.version });
    const unauthenticated = await httpGet(`${metadata.url}/capabilities`);
    assert.equal(unauthenticated.status, 401);
    assert.deepEqual(JSON.parse(unauthenticated.body), { error: { code: 'unauthorized', message: 'Missing or invalid daemon token' } });
    const capabilities = await httpGetJson(`${metadata.url}/capabilities`, { authorization: `Bearer ${metadata.token}` });
    assert.equal(capabilities.json.name, 'bluenote-daemon');
    assert.equal(capabilities.json.mode, 'local-only');
    assert.equal(capabilities.json.version, packageJson.version);
    assert.equal(capabilities.json.apiVersion, '1');
    assert.deepEqual({
      workspaceApi: capabilities.json.workspaceApi,
      notesApi: capabilities.json.notesApi,
      aiApi: capabilities.json.aiApi,
    }, {
      workspaceApi: true,
      notesApi: false,
      aiApi: false,
    });
    assert.ok(capabilities.json.clients.web);
    assert.ok(capabilities.json.clients.tui);
  } finally {
    await runCli(['daemon', 'stop'], { env });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testDaemonApiRouterErrors() {
  const { root, env } = makeDaemonEnv();
  try {
    const started = await runCli(['daemon', 'start'], { env });
    assert.equal(started.code, 0);
    const metadata = JSON.parse(fs.readFileSync(path.join(env.BLUENOTE_CONFIG_HOME, 'bluenote', 'daemon.json'), 'utf8'));

    const unauthorized = await httpPost(`${metadata.url}/shutdown`);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(JSON.parse(unauthorized.body), { error: { code: 'unauthorized', message: 'Missing or invalid daemon token' } });

    const missingUnauthenticated = await httpGet(`${metadata.url}/api/not-yet-implemented`);
    assert.equal(missingUnauthenticated.status, 401);
    assert.deepEqual(JSON.parse(missingUnauthenticated.body), { error: { code: 'unauthorized', message: 'Missing or invalid daemon token' } });

    const missing = await httpGet(`${metadata.url}/api/not-yet-implemented`, { authorization: `Bearer ${metadata.token}` });
    assert.equal(missing.status, 404);
    assert.deepEqual(JSON.parse(missing.body), { error: { code: 'not_found', message: 'Route not found' } });
  } finally {
    await runCli(['daemon', 'stop'], { env });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testWebAndTuiDoNotLoadClients() {
  const result = await runCli(['web'], {
    env: { ...process.env, PATH: '' },
    clientLoader() {
      throw new Error('client loader should not be called');
    },
  });
  assert.equal(result.code, 1);
}

async function testBuildOutputExists() {
  const binPath = path.join(__dirname, '..', 'dist', 'bin.js');
  assert.ok(fs.existsSync(binPath));
  const bin = fs.readFileSync(binPath, 'utf8');
  assert.ok(bin.startsWith('#!/usr/bin/env node'));
  assert.equal(fs.statSync(binPath).mode & 0o111, 0o111);
}

const tests = [
  testPackageMetadata,
  testVersionStatusScript,
  testVersionStatusScriptFailures,
  testHelpDoesNotLoadClients,
  testVersionDoesNotLoadClients,
  testDoctorDoesNotLoadClients,
  testCommandDiscovery,
  testDoctorReportsOptionalClients,
  testDoctorReportsBrokenClients,
  testUnknownCommand,
  testDaemonLifecycle,
  testDaemonStartDoesNotExposeTokenInArgv,
  testStaleDaemonMetadata,
  testClientLaunchRequiresDaemon,
  testClientLaunchUsesPathAndDaemonEnv,
  testClientLaunchRejectsStaleDaemonMetadataBeforeSpawning,
  testWindowsClientLaunchUsesShellForCmdShims,
  testMissingClientMessage,
  testDaemonHealthAndCapabilities,
  testDaemonApiRouterErrors,
  testWebAndTuiDoNotLoadClients,
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
