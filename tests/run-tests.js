'use strict';

const assert = require('assert').strict;
const EventEmitter = require('events');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const cli = require('../dist/cli.js');
const { findCommandOnPath } = require('../dist/utils/command-discovery.js');
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

async function httpGetJson(url, headers = {}) {
  const response = await httpGet(url, headers);
  return { status: response.status, json: JSON.parse(response.body) };
}

async function testPackageMetadata() {
  assert.equal(packageJson.name, '@lordierclaw/bluenote');
  assert.equal(packageJson.bin.bluenote, './dist/bin.js');
  assert.equal(packageJson.bin.bn, './dist/bin.js');
  for (const script of ['clean', 'build', 'typecheck', 'test', 'check']) {
    assert.ok(packageJson.scripts[script], `missing script ${script}`);
  }
  assert.match(packageJson.dependencies['@lordierclaw/bluenote-core'], /^git\+https:\/\/github\.com\/LordierClaw\/bluenote-core\.git#[0-9a-f]{40}$/);
  assert.equal(packageJson.dependencies['bluenote-term'], undefined);
  assert.equal(packageJson.dependencies['bluenote-webui'], undefined);
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
    const capabilities = await httpGetJson(`${metadata.url}/capabilities`, { authorization: `Bearer ${metadata.token}` });
    assert.equal(capabilities.json.name, 'bluenote-daemon');
    assert.equal(capabilities.json.mode, 'local-only');
    assert.equal(capabilities.json.version, packageJson.version);
    assert.ok(capabilities.json.clients.web);
    assert.ok(capabilities.json.clients.tui);
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
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'dist', 'bin.js')));
  const bin = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bin.js'), 'utf8');
  assert.ok(bin.startsWith('#!/usr/bin/env node'));
}

const tests = [
  testPackageMetadata,
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
