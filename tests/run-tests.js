'use strict';

const assert = require('assert').strict;
const childProcess = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const cli = require('../dist/cli.js');
const { findCommandOnPath, resolveClientCommand } = require('../dist/utils/command-discovery.js');
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
        '@lordierclaw/bluenote-core': 'latest',
      },
    },
    'bluenote-core': { name: '@lordierclaw/bluenote-core', version: '0.1.0' },
    'bluenote-webui': {
      name: '@lordierclaw/bluenote-webui',
      version: '0.1.0',
      dependencies: {
        '@lordierclaw/bluenote-core': 'latest',
      },
    },
    'bluenote-term': {
      name: '@lordierclaw/bluenote-term',
      version: '0.1.0',
      dependencies: {
        '@lordierclaw/bluenote-core': 'latest',
      },
    },
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

function readScript(relativePath) {
  const scriptPath = path.join(__dirname, '..', relativePath);
  assert.ok(fs.existsSync(scriptPath), `missing script ${relativePath}`);
  return fs.readFileSync(scriptPath, 'utf8');
}

function runScript(relativePath, args = [], options = {}) {
  return childProcess.spawnSync(path.join(__dirname, '..', relativePath), args, {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: options.env || process.env,
  });
}

function writeFakeNpm(binDir) {
  writeExecutable(path.join(binDir, 'npm'), [
    '#!/usr/bin/env bash',
    'if [ "$1" = "list" ] && [ "$2" = "-g" ]; then',
    "  printf '%s\\n' \"$BLUENOTE_TEST_NPM_LIST_JSON\"",
    '  exit 0',
    'fi',
    'if [ "$1" = "prefix" ] && [ "$2" = "-g" ]; then',
    "  printf '%s\\n' \"$BLUENOTE_TEST_NPM_PREFIX\"",
    '  exit 0',
    'fi',
    'if [ "$1" = "config" ] && [ "$2" = "get" ]; then',
    "  printf '%s\\n' \"$BLUENOTE_TEST_NPM_CONFIG_GET\"",
    '  exit 0',
    'fi',
    'if [ "$1" = "ping" ]; then',
    '  if [ -n "$BLUENOTE_TEST_NPM_PING_LOG" ]; then',
    "    printf '%s\\n' \"$*\" >> \"$BLUENOTE_TEST_NPM_PING_LOG\"",
    '  fi',
    '  exit "${BLUENOTE_TEST_NPM_PING_STATUS:-0}"',
    'fi',
    'exit 0',
    '',
  ].join('\n'));
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


function readWorkspaceReadmes(workspaceRoot = path.resolve(__dirname, '..', '..')) {
  const repoFiles = {
    bluenote: {
      readme: path.join(workspaceRoot, 'bluenote', 'README.md'),
      packageJson: path.join(workspaceRoot, 'bluenote', 'package.json'),
      packageName: '@lordierclaw/bluenote',
    },
    'bluenote-core': {
      readme: path.join(workspaceRoot, 'bluenote-core', 'README.md'),
      packageJson: path.join(workspaceRoot, 'bluenote-core', 'package.json'),
      packageName: '@lordierclaw/bluenote-core',
    },
    'bluenote-webui': {
      readme: path.join(workspaceRoot, 'bluenote-webui', 'README.md'),
      packageJson: path.join(workspaceRoot, 'bluenote-webui', 'package.json'),
      packageName: '@lordierclaw/bluenote-webui',
    },
    'bluenote-term': {
      readme: path.join(workspaceRoot, 'bluenote-term', 'README.md'),
      packageJson: path.join(workspaceRoot, 'bluenote-term', 'packages', 'term', 'package.json'),
      packageName: '@lordierclaw/bluenote-term',
    },
  };
  for (const [repoName, repo] of Object.entries(repoFiles)) {
    if (!fs.existsSync(repo.readme) || !fs.existsSync(repo.packageJson)) {
      process.stdout.write(`SKIP README contract: missing sibling checkout for ${repoName}\n`);
      return undefined;
    }
    const parsed = JSON.parse(fs.readFileSync(repo.packageJson, 'utf8'));
    if (parsed.name !== repo.packageName) {
      process.stdout.write(`SKIP README contract: ${repoName} package mismatch at ${repo.packageJson}\n`);
      return undefined;
    }
  }
  return Object.fromEntries(Object.entries(repoFiles).map(([repoName, repo]) => [repoName, fs.readFileSync(repo.readme, 'utf8')]))
}

function readSiblingReadmes() {
  return readWorkspaceReadmes();
}

function readReleaseWorkflow() {
  const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'release.yml');
  assert.ok(fs.existsSync(workflowPath), 'missing release workflow');
  return fs.readFileSync(workflowPath, 'utf8');
}

async function testPackageMetadata() {
  assert.equal(packageJson.name, '@lordierclaw/bluenote');
  assert.equal(packageJson.version, '0.4.4');
  assert.deepEqual(packageJson.files, ['dist', 'README.md', 'LICENSE', 'package.json']);
  assert.equal(packageLock.name, packageJson.name);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].name, packageJson.name);
  assert.equal(packageLock.packages[''].version, packageJson.version);
  assert.equal(packageJson.bin.bluenote, './dist/bin.js');
  assert.equal(packageJson.bin.bn, './dist/bin.js');
  assert.deepEqual(packageJson.repository, {
    type: 'git',
    url: 'https://github.com/LordierClaw/bluenote',
  });
  for (const script of ['clean', 'build', 'typecheck', 'test', 'check']) {
    assert.ok(packageJson.scripts[script], `missing script ${script}`);
  }
  assert.equal(packageJson.dependencies['@lordierclaw/bluenote-core'], 'latest');
  assert.equal(packageLock.packages[''].dependencies['@lordierclaw/bluenote-core'], 'latest');
  assert.equal(packageJson.dependencies['bluenote-term'], undefined);
  assert.equal(packageJson.dependencies['bluenote-webui'], undefined);
}

async function testVersionStatusScript() {
  const workspaceRoot = writeVersionStatusFixture();

  const strictResult = runVersionStatus(['--workspace-root', workspaceRoot]);
  assert.equal(strictResult.status, 0, strictResult.stderr);
  assert.match(strictResult.stdout, /BlueNote package versions/);
  assert.equal(strictResult.stderr, '');

  const result = runVersionStatus(['--workspace-root', workspaceRoot, '--allow-git-deps']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /BlueNote package versions/);
  assert.match(result.stdout, /@lordierclaw\/bluenote\s+0\.1\.0/);
  assert.match(result.stdout, /@lordierclaw\/bluenote-core\s+0\.1\.0/);
  assert.match(result.stdout, /@lordierclaw\/bluenote-webui\s+0\.1\.0/);
  assert.match(result.stdout, /@lordierclaw\/bluenote-term\s+0\.1\.0/);
  assert.equal(result.stderr, '');

  const exactDepRoot = writeVersionStatusFixture({
    bluenote: {
      dependencies: {
        '@lordierclaw/bluenote-core': '0.1.0',
      },
    },
  });
  const exactDep = runVersionStatus(['--workspace-root', exactDepRoot]);
  assert.equal(exactDep.status, 0, exactDep.stderr);
}

async function testVersionStatusScriptFailures() {
  for (const [repoName, packagePath] of Object.entries({
    bluenote: 'bluenote/package.json',
    'bluenote-webui': 'bluenote-webui/package.json',
    'bluenote-term': 'bluenote-term/packages/term/package.json',
  })) {
    const gitDepRoot = writeVersionStatusFixture({
      [repoName]: {
        dependencies: {
          '@lordierclaw/bluenote-core': 'git+https://github.com/LordierClaw/bluenote-core.git#0123456789abcdef0123456789abcdef01234567',
        },
      },
    });
    const gitDep = runVersionStatus(['--workspace-root', gitDepRoot]);
    assert.notEqual(gitDep.status, 0);
    assert.match(gitDep.stderr, new RegExp(escapeRegExp(packagePath)));
    assert.match(gitDep.stderr, /Git dependency is not allowed in release mode/);

    const gitDepAllowed = runVersionStatus(['--workspace-root', gitDepRoot, '--allow-git-deps']);
    assert.equal(gitDepAllowed.status, 0, gitDepAllowed.stderr);

    const rangeDepRoot = writeVersionStatusFixture({
      [repoName]: {
        dependencies: {
          '@lordierclaw/bluenote-core': '^0.1.0',
        },
      },
    });
    const rangeDep = runVersionStatus(['--workspace-root', rangeDepRoot]);
    assert.notEqual(rangeDep.status, 0);
    assert.match(rangeDep.stderr, new RegExp(escapeRegExp(packagePath)));
    assert.match(rangeDep.stderr, /must use latest, an exact semver, or a Git dependency/);

    const rangeDepAllowed = runVersionStatus(['--workspace-root', rangeDepRoot, '--allow-git-deps']);
    assert.notEqual(rangeDepAllowed.status, 0);
    assert.match(rangeDepAllowed.stderr, new RegExp(escapeRegExp(packagePath)));
    assert.match(rangeDepAllowed.stderr, /must use latest, an exact semver, or a Git dependency/);
  }

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

async function testReadmeStructureContract() {
  const readmes = readSiblingReadmes();
  if (!readmes) return;

  const requiredHeadings = [
    '## Role in BlueNote',
    '## Install',
    '## Local development',
    '## Scripts',
    '## Packaging and versions',
    '## Cross-platform notes',
    '## Related packages',
  ];

  for (const [repoName, readme] of Object.entries(readmes)) {
    let previousIndex = -1;
    for (const heading of requiredHeadings) {
      const index = readme.indexOf(heading);
      assert.notEqual(index, -1, `${repoName} README missing ${heading}`);
      assert.ok(index > previousIndex, `${repoName} README has ${heading} out of order`);
      previousIndex = index;
    }

    assert.doesNotMatch(readme, /npm install(?: -g)? bluenote-(?:webui|term)\b/, `${repoName} README uses an old unscoped client package install example`);
    assert.doesNotMatch(readme, /npm install(?: -g)? bluenote-core\b/, `${repoName} README uses an old unscoped core package install example`);
    assert.doesNotMatch(readme, /npm install(?: -g)? bluenote\b/, `${repoName} README uses an old unscoped distribution package install example`);
  }

  assert.match(readmes.bluenote, /development mode may use pinned Git deps/i, 'bluenote README should explain that development mode may use pinned Git dependencies');
  assert.match(readmes.bluenote, /exact published semver are both acceptable release-mode dependency shapes/i, 'bluenote README should explain the allowed published core dependency shapes');
  assert.match(readmes.bluenote, /npm run version:status`?\s+checks the four sibling package names and versions/i, 'bluenote README should describe the version status check');
  assert.doesNotMatch(readmes.bluenote, /release-like dependency modes, prefer published npm versions or immutable Git tags\/commits/i, 'bluenote README should not describe Git dependencies as acceptable in release mode');
}

async function testDevLocalScriptsContract() {
  const installSh = readScript('scripts/dev-install-local.sh');
  const uninstallSh = readScript('scripts/dev-uninstall-local.sh');
  const installPs = readScript('scripts/dev-install-local.ps1');
  const uninstallPs = readScript('scripts/dev-uninstall-local.ps1');

  const workspaceRoot = path.resolve(__dirname, '..', '..');
  const requiredSiblingPaths = [
    path.join(workspaceRoot, 'bluenote-webui', 'package.json'),
    path.join(workspaceRoot, 'bluenote-term', 'packages', 'term', 'package.json'),
  ];
  if (requiredSiblingPaths.some((requiredPath) => !fs.existsSync(requiredPath))) {
    process.stdout.write('SKIP dev local scripts contract: missing sibling checkout for bluenote-webui or bluenote-term\n');
    return;
  }

  assert.match(installSh, /set -euo pipefail/);
  assert.match(uninstallSh, /set -euo pipefail/);
  for (const [name, script] of Object.entries({ installPs, uninstallPs })) {
    assert.match(script, /param\s*\(/i, `${name} should define param(...)`);
    assert.match(script, /\[switch\]\s*\$DryRun/i, `${name} should support -DryRun`);
    assert.match(script, /\$LASTEXITCODE/, `${name} should fail on native command non-zero exits`);
  }

  const installDryRun = runScript('scripts/dev-install-local.sh', ['--all', '--dry-run']);
  assert.equal(installDryRun.status, 0, installDryRun.stderr);
  assert.match(installDryRun.stdout, /cd .*bluenote(?:\s|$)/);
  assert.match(installDryRun.stdout, /npm (?:run check|link)/);
  assert.match(installDryRun.stdout, /cd .*bluenote-webui(?:\s|$)/);
  assert.match(installDryRun.stdout, /cd .*bluenote-term\/packages\/term(?:\s|$)/);
  assert.match(installDryRun.stdout, /bun link/);

  const uninstallDryRun = runScript('scripts/dev-uninstall-local.sh', ['--all', '--dry-run']);
  assert.equal(uninstallDryRun.status, 0, uninstallDryRun.stderr);
  assert.match(uninstallDryRun.stdout, /cd .*bluenote(?:\s|$).*npm run check/);
  assert.match(uninstallDryRun.stdout, /cd .*bluenote-webui(?:\s|$).*npm run check/);
  assert.match(uninstallDryRun.stdout, /cd .*bluenote-term(?:\s|$).*bun run check/);
  const stopIndex = uninstallDryRun.stdout.indexOf('bluenote daemon stop');
  const unlinkIndex = uninstallDryRun.stdout.search(/npm unlink|bun unlink/);
  assert.notEqual(stopIndex, -1, 'uninstall dry-run should stop daemon');
  assert.notEqual(unlinkIndex, -1, 'uninstall dry-run should unlink packages');
  assert.ok(stopIndex < unlinkIndex, 'uninstall should stop daemon before unlink attempts');
  assert.match(uninstallDryRun.stdout, /npm unlink -g @lordierclaw\/bluenote/);
  assert.match(uninstallDryRun.stdout, /npm unlink -g @lordierclaw\/bluenote-webui/);
  assert.match(uninstallDryRun.stdout, /cd .*bluenote-term\/packages\/term(?:\s|$).*bun unlink(?:\s|$)/);
  assert.doesNotMatch(uninstallDryRun.stdout, /bun unlink @lordierclaw\/bluenote-term/);
}

async function testReleaseWorkflowSiblingCheckoutContract() {
  const workflow = readReleaseWorkflow();

  assert.match(
    workflow,
    /release:\s+types:\s+\[published\]/m,
    'release workflow should run from published GitHub releases',
  );
  assert.match(
    workflow,
    /npm install -g\s+\\\s*@lordierclaw\/bluenote-webui@latest\s+\\\s*@lordierclaw\/bluenote-term@latest\s+\\\s*"\/workspace\/\$\{PACKAGE_TARBALL\}"/m,
    'release workflow should verify the local distribution tarball alongside latest published optional clients',
  );
  assert.doesNotMatch(
    workflow,
    /Checkout bluenote-core release sibling|Checkout bluenote-webui release sibling|Checkout bluenote-term release sibling/m,
    'release workflow should no longer require same-tag sibling repo checkouts',
  );
}

async function testInstallerPreflightContract() {
  const installSh = readScript('scripts/install.sh');
  const uninstallSh = readScript('scripts/uninstall.sh');
  const installPs = readScript('scripts/install.ps1');
  const uninstallPs = readScript('scripts/uninstall.ps1');
  const combined = [installSh, uninstallSh, installPs, uninstallPs].join('\n');

  assert.match(installSh, /set -Eeuo pipefail/);
  assert.match(uninstallSh, /set -Eeuo pipefail/);
  for (const [name, script] of Object.entries({ installPs, uninstallPs })) {
    assert.match(script, /param\s*\(/i, `${name} should define param(...)`);
    assert.match(script, /\[switch\]\s*\$DryRun/i, `${name} should support dry-run`);
    assert.match(script, /ExecutionPolicy|PSSecurityException/i, `${name} should mention PowerShell execution policy guidance`);
    assert.match(script, /\[Console\]::Error\.WriteLine/, `${name} should print recovery errors without terminating before rollback`);
  }

  for (const phrase of [
    'old package', 'unscoped', 'older scoped package', 'newer installed version', 'mixed install',
    'stale daemon', 'partial previous install', 'unknown files', 'npm global prefix',
    'GitHub Packages', 'unsupported OS/architecture/platform', 'missing required runtime',
    'before mutating state', 'best-effort rollback', 'Recovery command', 'preserve user notes/config/data',
    'delete my bluenote data'
  ]) {
    assert.match(combined, new RegExp(escapeRegExp(phrase), 'i'), `installer contract missing ${phrase}`);
  }
  assert.match(combined, /upgrade|repair|skip|abort/i, 'interactive conflict choices should be explicit');
  assert.match(combined, /fail instead of overwriting|fail.*unknown|abort.*conflict/i, 'non-interactive mode should fail on unknown conflicts');
  assert.match(combined, /built terminal artifact|built TUI|built-binary mode/i, 'TUI path should use built artifacts, not Bun source installs');
  assert.doesNotMatch(installSh, /bun install|curl.*bun|install bun/i, 'user installer must not auto-install Bun');

  const installDryRun = runScript('scripts/install.sh', ['--dry-run']);
  assert.equal(installDryRun.status, 0, installDryRun.stderr);
  assert.match(installDryRun.stdout, /Install mode: interactive/i);
  assert.match(installDryRun.stdout, /Default selected clients: @lordierclaw\/bluenote only/i);
  assert.match(installDryRun.stdout, /\[x\] @lordierclaw\/bluenote\b/i);
  assert.match(installDryRun.stdout, /\[ \] @lordierclaw\/bluenote-webui/i);
  assert.match(installDryRun.stdout, /\[ \] @lordierclaw\/bluenote-term built terminal artifact/i);
  assert.match(installDryRun.stdout, /all clients/i);
  assert.match(installDryRun.stdout, /npmjs.*default/i);
  assert.match(installDryRun.stdout, /GitHub Packages/i);
  assert.match(installDryRun.stdout, /run after install: bluenote doctor/i);
  assert.match(installDryRun.stdout, /preserve user notes\/config\/data/i);
  assert.doesNotMatch(installDryRun.stdout, /@lordierclaw:registry=https:\/\/npm\.pkg\.github\.com/);

  const installYesDryRun = runScript('scripts/install.sh', ['--yes', '--dry-run']);
  assert.equal(installYesDryRun.status, 0, installYesDryRun.stderr);
  assert.match(installYesDryRun.stdout, /Install mode: non-interactive/i);
  assert.match(installYesDryRun.stdout, /non-interactive safe defaults/i);
  assert.match(installYesDryRun.stdout, /install package: @lordierclaw\/bluenote@latest/);
  assert.doesNotMatch(installYesDryRun.stdout, /optional package: @lordierclaw\/bluenote-webui/);
  assert.doesNotMatch(installYesDryRun.stdout, /optional package: @lordierclaw\/bluenote-term built terminal artifact/);

  const webDryRun = runScript('scripts/install.sh', ['--with-web', '--dry-run']);
  assert.equal(webDryRun.status, 0, webDryRun.stderr);
  assert.match(webDryRun.stdout, /optional package: @lordierclaw\/bluenote-webui@latest/);

  const tuiDryRun = runScript('scripts/install.sh', ['--with-tui', '--dry-run']);
  assert.equal(tuiDryRun.status, 0, tuiDryRun.stderr);
  assert.match(tuiDryRun.stdout, /optional built terminal artifact: copy BLUENOTE_TERM_ARTIFACT_PATH/);
  assert.match(tuiDryRun.stdout, /does not require Bun at runtime/i);
  assert.match(tuiDryRun.stdout, /BLUENOTE_CLIENT_MODE=built/);
  assert.match(tuiDryRun.stdout, /BLUENOTE_BUILT_CLIENT_DIR/);
  assert.match(tuiDryRun.stdout, /client-mode record/i);
  assert.match(tuiDryRun.stdout, /managed built client executable/i);
  assert.doesNotMatch(tuiDryRun.stdout, /bun install|fallback to Bun/i);

  const builtModeWithoutTui = runScript('scripts/install.sh', ['--client-mode', 'built', '--dry-run']);
  assert.notEqual(builtModeWithoutTui.status, 0);
  assert.match(builtModeWithoutTui.stderr, /--client-mode built requires --with-tui/i);

  assert.match(installSh, /managed built client executable/);
  assert.match(installSh, /BLUENOTE_TERM_ARTIFACT_PATH/);
  assert.doesNotMatch(installSh, /exec bluenote-term/);
  assert.match(installPs, /Copy-Item -LiteralPath \$env:BLUENOTE_TERM_ARTIFACT_PATH -Destination \$shimPath -Force/);
  assert.match(installPs, /Set-Content -LiteralPath \$recordPath/);
  assert.match(installPs, /bluenote-term\.exe/);
  assert.match(installPs, /BLUENOTE_CLIENT_MODE=built/);

  const allDryRun = runScript('scripts/install.sh', ['--all', '--dry-run']);
  assert.equal(allDryRun.status, 0, allDryRun.stderr);
  assert.match(allDryRun.stdout, /@lordierclaw\/bluenote-webui/);
  assert.match(allDryRun.stdout, /optional built terminal artifact: copy BLUENOTE_TERM_ARTIFACT_PATH/);

  const githubDryRun = runScript('scripts/install.sh', ['--registry', 'github', '--dry-run']);
  assert.equal(githubDryRun.status, 0, githubDryRun.stderr);
  assert.match(githubDryRun.stdout, /@lordierclaw:registry=https:\/\/npm\.pkg\.github\.com/);
  assert.match(githubDryRun.stdout, /NODE_AUTH_TOKEN|GH_TOKEN/);

  const preflightBin = makeTempDir('installer-preflight-bin');
  const preflightPrefix = makeTempDir('installer-preflight-prefix');
  writeFakeNpm(preflightBin);

  const oldPackageRun = runScript('scripts/install.sh', ['--yes', '--dry-run'], {
    env: {
      ...process.env,
      PATH: `${preflightBin}${path.delimiter}${process.env.PATH || ''}`,
      BLUENOTE_TEST_NPM_PREFIX: preflightPrefix,
      BLUENOTE_TEST_NPM_LIST_JSON: JSON.stringify({ dependencies: { bluenote: { version: '0.0.5' } } }),
    },
  });
  assert.notEqual(oldPackageRun.status, 0);
  assert.match(oldPackageRun.stderr + oldPackageRun.stdout, /old\/unscoped package installed: bluenote@0\.0\.5/i);

  const olderScopedRun = runScript('scripts/install.sh', ['--yes', '--dry-run'], {
    env: {
      ...process.env,
      PATH: `${preflightBin}${path.delimiter}${process.env.PATH || ''}`,
      BLUENOTE_TEST_NPM_PREFIX: preflightPrefix,
      BLUENOTE_TEST_NPM_LIST_JSON: JSON.stringify({ dependencies: { '@lordierclaw/bluenote': { version: '0.0.5' } } }),
    },
  });
  assert.notEqual(olderScopedRun.status, 0);
  assert.match(olderScopedRun.stderr + olderScopedRun.stdout, /older scoped package installed: @lordierclaw\/bluenote@0\.0\.5 < requested 0\.4\.4/i);

  const olderScopedTermRun = runScript('scripts/install.sh', ['--yes', '--with-tui', '--dry-run'], {
    env: {
      ...process.env,
      PATH: `${preflightBin}${path.delimiter}${process.env.PATH || ''}`,
      BLUENOTE_TEST_NPM_PREFIX: preflightPrefix,
      BLUENOTE_TEST_NPM_LIST_JSON: JSON.stringify({ dependencies: { '@lordierclaw/bluenote-term': { version: '0.0.5' } } }),
    },
  });
  assert.notEqual(olderScopedTermRun.status, 0);
  assert.match(olderScopedTermRun.stderr + olderScopedTermRun.stdout, /older scoped package installed: @lordierclaw\/bluenote-term@0\.0\.5 < requested 0\.4\.4/i);

  const cliOnlyIgnoresOptionalClientVersionRun = runScript('scripts/install.sh', ['--yes', '--dry-run'], {
    env: {
      ...process.env,
      PATH: `${preflightBin}${path.delimiter}${process.env.PATH || ''}`,
      BLUENOTE_TEST_NPM_PREFIX: preflightPrefix,
      BLUENOTE_TEST_NPM_LIST_JSON: JSON.stringify({ dependencies: { '@lordierclaw/bluenote-term': { version: '0.0.5' } } }),
    },
  });
  assert.equal(cliOnlyIgnoresOptionalClientVersionRun.status, 0, cliOnlyIgnoresOptionalClientVersionRun.stderr);
  assert.doesNotMatch(cliOnlyIgnoresOptionalClientVersionRun.stderr + cliOnlyIgnoresOptionalClientVersionRun.stdout, /older scoped package installed: @lordierclaw\/bluenote-term@0\.0\.5 < requested 0\.4\.4/i);

  const outOfRepoCwd = makeTempDir('installer-out-of-repo-cwd');
  const outOfRepoVersionRun = childProcess.spawnSync(path.join(__dirname, '..', 'scripts', 'install.sh'), ['--yes', '--dry-run'], {
    cwd: outOfRepoCwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${preflightBin}${path.delimiter}${process.env.PATH || ''}`,
      BLUENOTE_TEST_NPM_PREFIX: preflightPrefix,
      BLUENOTE_TEST_NPM_LIST_JSON: JSON.stringify({ dependencies: { '@lordierclaw/bluenote': { version: '0.0.5' } } }),
    },
  });
  assert.notEqual(outOfRepoVersionRun.status, 0);
  assert.match(outOfRepoVersionRun.stderr + outOfRepoVersionRun.stdout, /older scoped package installed: @lordierclaw\/bluenote@0\.0\.5 < requested 0\.4\.4/i);

  const partialConfigHome = makeTempDir('installer-partial-config-home');
  fs.mkdirSync(path.join(partialConfigHome, 'bluenote'), { recursive: true });
  fs.writeFileSync(path.join(partialConfigHome, 'bluenote', 'client-mode.env'), 'BLUENOTE_CLIENT_MODE=built\nBLUENOTE_BUILT_CLIENT_DIR=/missing\n');
  const partialRun = runScript('scripts/install.sh', ['--yes', '--dry-run'], {
    env: {
      ...process.env,
      PATH: `${preflightBin}${path.delimiter}${process.env.PATH || ''}`,
      BLUENOTE_TEST_NPM_PREFIX: preflightPrefix,
      BLUENOTE_TEST_NPM_LIST_JSON: JSON.stringify({ dependencies: {} }),
      BLUENOTE_CONFIG_HOME: partialConfigHome,
    },
  });
  assert.notEqual(partialRun.status, 0);
  assert.match(partialRun.stderr + partialRun.stdout, /partial previous install detected: client-mode record exists without built client executable/i);

  const recordedBuiltConfigHome = makeTempDir('installer-recorded-built-config-home');
  const preflightRecordedBuiltDir = path.join(makeTempDir('installer-recorded-built-dir'), 'clients');
  fs.mkdirSync(path.join(recordedBuiltConfigHome, 'bluenote'), { recursive: true });
  fs.mkdirSync(preflightRecordedBuiltDir, { recursive: true });
  fs.writeFileSync(path.join(preflightRecordedBuiltDir, 'bluenote-term'), 'existing built client\n');
  fs.writeFileSync(path.join(recordedBuiltConfigHome, 'bluenote', 'client-mode.env'), `BLUENOTE_CLIENT_MODE=built\nBLUENOTE_BUILT_CLIENT_DIR=${preflightRecordedBuiltDir}\n`);
  const recordedBuiltRun = runScript('scripts/install.sh', ['--yes', '--dry-run'], {
    env: {
      ...process.env,
      PATH: `${preflightBin}${path.delimiter}${process.env.PATH || ''}`,
      BLUENOTE_TEST_NPM_PREFIX: preflightPrefix,
      BLUENOTE_TEST_NPM_LIST_JSON: JSON.stringify({ dependencies: {} }),
      BLUENOTE_CONFIG_HOME: recordedBuiltConfigHome,
    },
  });
  assert.equal(recordedBuiltRun.status, 0, recordedBuiltRun.stderr);
  assert.doesNotMatch(recordedBuiltRun.stderr + recordedBuiltRun.stdout, /partial previous install detected/i);

  const githubAuthRun = runScript('scripts/install.sh', ['--yes', '--registry', 'github', '--dry-run'], {
    env: {
      ...process.env,
      PATH: `${preflightBin}${path.delimiter}${process.env.PATH || ''}`,
      BLUENOTE_TEST_NPM_PREFIX: preflightPrefix,
      BLUENOTE_TEST_NPM_LIST_JSON: JSON.stringify({ dependencies: {} }),
      BLUENOTE_TEST_NPM_CONFIG_GET: 'undefined',
      NODE_AUTH_TOKEN: '',
      GH_TOKEN: '',
    },
  });
  assert.notEqual(githubAuthRun.status, 0);
  assert.match(githubAuthRun.stderr + githubAuthRun.stdout, /GitHub Packages auth missing/i);

  const githubPingLog = path.join(makeTempDir('installer-github-ping-log'), 'npm-ping.log');
  const githubReachableRun = runScript('scripts/install.sh', ['--yes', '--registry', 'github', '--dry-run'], {
    env: {
      ...process.env,
      PATH: `${preflightBin}${path.delimiter}${process.env.PATH || ''}`,
      BLUENOTE_TEST_NPM_PREFIX: preflightPrefix,
      BLUENOTE_TEST_NPM_LIST_JSON: JSON.stringify({ dependencies: {} }),
      BLUENOTE_TEST_NPM_CONFIG_GET: 'token-present',
      BLUENOTE_TEST_NPM_PING_LOG: githubPingLog,
    },
  });
  assert.equal(githubReachableRun.status, 0, githubReachableRun.stderr);
  assert.match(fs.readFileSync(githubPingLog, 'utf8'), /ping --registry https:\/\/npm\.pkg\.github\.com/);

  const prefixFailureRun = runScript('scripts/install.sh', ['--yes', '--dry-run'], {
    env: {
      ...process.env,
      PATH: `${preflightBin}${path.delimiter}${process.env.PATH || ''}`,
      BLUENOTE_TEST_NPM_PREFIX: path.join(makeTempDir('installer-missing-prefix'), 'does-not-exist'),
      BLUENOTE_TEST_NPM_LIST_JSON: JSON.stringify({ dependencies: {} }),
    },
  });
  assert.notEqual(prefixFailureRun.status, 0);
  assert.match(prefixFailureRun.stderr + prefixFailureRun.stdout, /npm global prefix not writable or missing/i);

  const conflictBin = makeTempDir('installer-conflict-bin');
  writeExecutable(path.join(conflictBin, 'bluenote'));
  const conflictInteractive = runScript('scripts/install.sh', ['--dry-run'], { env: { ...process.env, PATH: `${conflictBin}${path.delimiter}${process.env.PATH || ''}` } });
  assert.equal(conflictInteractive.status, 0, conflictInteractive.stderr);
  assert.match(conflictInteractive.stdout, /Conflict found/i);
  assert.match(conflictInteractive.stdout, /safe choices: upgrade, repair, skip, abort/i);
  const conflictRun = runScript('scripts/install.sh', ['--yes', '--dry-run'], { env: { ...process.env, PATH: `${conflictBin}${path.delimiter}${process.env.PATH || ''}` } });
  assert.notEqual(conflictRun.status, 0);
  assert.match(conflictRun.stderr + conflictRun.stdout, /non-interactive conflict failure/i);

  const unknownArtifactDir = makeTempDir('installer-unknown-artifact');
  fs.writeFileSync(path.join(unknownArtifactDir, 'mystery-file'), 'do not overwrite');
  const artifactConflict = runScript('scripts/install.sh', ['--yes', '--with-tui', '--dry-run'], { env: { ...process.env, BLUENOTE_BUILT_CLIENT_DIR: unknownArtifactDir } });
  assert.notEqual(artifactConflict.status, 0);
  assert.match(artifactConflict.stderr + artifactConflict.stdout, /unknown files/i);
  assert.match(artifactConflict.stderr + artifactConflict.stdout, /non-interactive conflict failure/i);

  const managedHome = makeTempDir('installer-default-built-home');
  const managedBuiltDir = path.join(managedHome, '.local', 'share', 'bluenote', 'clients');
  fs.mkdirSync(managedBuiltDir, { recursive: true });
  fs.writeFileSync(path.join(managedBuiltDir, 'mystery-file'), 'do not overwrite');
  const defaultCliOnly = runScript('scripts/install.sh', ['--yes', '--dry-run'], { env: { ...process.env, HOME: managedHome } });
  assert.equal(defaultCliOnly.status, 0, defaultCliOnly.stderr);
  const defaultArtifactConflict = runScript('scripts/install.sh', ['--yes', '--with-tui', '--dry-run'], { env: { ...process.env, HOME: managedHome } });
  assert.notEqual(defaultArtifactConflict.status, 0);
  assert.match(defaultArtifactConflict.stderr + defaultArtifactConflict.stdout, /unknown files in built artifact install directory/i);
  assert.match(defaultArtifactConflict.stderr + defaultArtifactConflict.stdout, new RegExp(escapeRegExp(managedBuiltDir)));

  const fakeUnameBin = makeTempDir('installer-fake-uname-bin');
  writeExecutable(path.join(fakeUnameBin, 'uname'), '#!/usr/bin/env bash\nif [ "$1" = "-s" ]; then\n  printf "FreeBSD\\n"\nelif [ "$1" = "-m" ]; then\n  printf "x86_64\\n"\nelse\n  printf "FreeBSD x86_64\\n"\nfi\n');
  const unsupportedTuiDryRun = runScript('scripts/install.sh', ['--with-tui', '--dry-run'], { env: { ...process.env, PATH: `${fakeUnameBin}${path.delimiter}${process.env.PATH || ''}` } });
  assert.notEqual(unsupportedTuiDryRun.status, 0);
  assert.match(unsupportedTuiDryRun.stderr + unsupportedTuiDryRun.stdout, /unsupported OS\/architecture\/platform.*cannot install built terminal artifact/i);
  assert.doesNotMatch(unsupportedTuiDryRun.stdout, /optional built terminal artifact: copy BLUENOTE_TERM_ARTIFACT_PATH/);
  assert.doesNotMatch(unsupportedTuiDryRun.stdout, /BLUENOTE_CLIENT_MODE=built/);

  const nonInteractiveDefault = runScript('scripts/install.sh', []);
  assert.notEqual(nonInteractiveDefault.status, 0);
  assert.match(nonInteractiveDefault.stderr, /default install is interactive; use --yes/i);

  const rollbackHome = makeTempDir('installer-rollback-home');
  const rollbackBuiltDir = path.join(rollbackHome, '.local', 'share', 'bluenote', 'clients');
  const rollbackConfigHome = path.join(rollbackHome, 'config-home');
  const rollbackConfigDir = path.join(rollbackConfigHome, 'bluenote');
  const rollbackBin = makeTempDir('installer-rollback-bin');
  const rollbackInstalledBin = makeTempDir('installer-rollback-installed-bin');
  const rollbackArtifact = path.join(makeTempDir('installer-artifact'), 'bluenote-term');
  const rollbackNpmLog = path.join(makeTempDir('installer-rollback-npm-log'), 'npm.log');
  fs.mkdirSync(rollbackBuiltDir, { recursive: true });
  fs.mkdirSync(rollbackConfigDir, { recursive: true });
  fs.writeFileSync(path.join(rollbackBuiltDir, 'bluenote-term'), 'old built client\n');
  fs.writeFileSync(path.join(rollbackConfigDir, 'client-mode.env'), `BLUENOTE_CLIENT_MODE=built\nBLUENOTE_BUILT_CLIENT_DIR=${rollbackBuiltDir}\n`);
  writeExecutable(path.join(rollbackBin, 'node'), '#!/usr/bin/env bash\nexit 0\n');
  writeExecutable(path.join(rollbackBin, 'npm'), `#!/usr/bin/env bash
printf '%s\n' "$*" >> ${JSON.stringify(rollbackNpmLog)}
if [ "$1" = "list" ] && [ "$2" = "-g" ]; then
  printf '{"dependencies":{}}\n'
  exit 0
fi
if [ "$1" = "prefix" ] && [ "$2" = "-g" ]; then
  printf '%s\n' ${JSON.stringify(rollbackInstalledBin)}
  exit 0
fi
if [ "$1" = "config" ] && [ "$2" = "get" ]; then
  printf 'undefined\n'
  exit 0
fi
if [ "$1" = "install" ]; then
  cat > ${JSON.stringify(path.join(rollbackInstalledBin, 'bluenote'))} <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "doctor" ]; then
  echo "doctor failed" >&2
  exit 1
fi
exit 0
EOF
  chmod 755 ${JSON.stringify(path.join(rollbackInstalledBin, 'bluenote'))}
fi
exit 0
`);
  writeExecutable(rollbackArtifact, '#!/usr/bin/env bash\necho new built client\n');
  const rollbackRun = runScript('scripts/install.sh', ['--yes', '--with-tui'], {
    env: {
      ...process.env,
      HOME: rollbackHome,
      BLUENOTE_CONFIG_HOME: rollbackConfigHome,
      BLUENOTE_TERM_ARTIFACT_PATH: rollbackArtifact,
      PATH: `${rollbackBin}${path.delimiter}${rollbackInstalledBin}${path.delimiter}${process.env.PATH || ''}`,
    },
  });
  assert.notEqual(rollbackRun.status, 0);
  assert.match(fs.readFileSync(rollbackNpmLog, 'utf8'), /uninstall -g @lordierclaw\/bluenote/);
  assert.match(rollbackRun.stderr + rollbackRun.stdout, /restore artifact:/i);
  assert.equal(fs.readFileSync(path.join(rollbackBuiltDir, 'bluenote-term'), 'utf8'), 'old built client\n');
  assert.equal(fs.readFileSync(path.join(rollbackConfigDir, 'client-mode.env'), 'utf8'), `BLUENOTE_CLIENT_MODE=built\nBLUENOTE_BUILT_CLIENT_DIR=${rollbackBuiltDir}\n`);

  const failRun = runScript('scripts/install.sh', ['--yes', '--simulate-failure-for-tests']);
  assert.notEqual(failRun.status, 0);
  assert.match(failRun.stderr + failRun.stdout, /Recovery command/);
  assert.match(failRun.stderr + failRun.stdout, /best-effort rollback/i);

  const uninstallDryRun = runScript('scripts/uninstall.sh', ['--dry-run']);
  assert.equal(uninstallDryRun.status, 0, uninstallDryRun.stderr);
  const stopIndex = uninstallDryRun.stdout.indexOf('bluenote daemon stop');
  const uninstallIndex = uninstallDryRun.stdout.indexOf('npm uninstall -g @lordierclaw/bluenote');
  assert.notEqual(stopIndex, -1, 'uninstall dry-run should stop daemon first');
  assert.notEqual(uninstallIndex, -1, 'uninstall dry-run should uninstall packages');
  assert.ok(stopIndex < uninstallIndex, 'uninstall should stop daemon before package removal');
  assert.match(uninstallDryRun.stdout, /@lordierclaw\/bluenote-webui/);
  assert.match(uninstallDryRun.stdout, /optionally remove managed @lordierclaw\/bluenote-term built terminal artifact/i);
  assert.match(uninstallDryRun.stdout, /remove managed built client executable/i);
  assert.match(uninstallDryRun.stdout, /preserve user notes\/config\/data/i);
  assert.doesNotMatch(uninstallDryRun.stdout, /rm -rf .*BLUENOTE_DATA_HOME/);

  const uninstallConfigHome = makeTempDir('uninstall-client-mode-config');
  const uninstallConfigDir = path.join(uninstallConfigHome, 'bluenote');
  const recordedBuiltDir = path.join(makeTempDir('uninstall-built-dir'), 'clients');
  fs.mkdirSync(uninstallConfigDir, { recursive: true });
  fs.writeFileSync(path.join(uninstallConfigDir, 'client-mode.env'), `BLUENOTE_CLIENT_MODE=built\nBLUENOTE_BUILT_CLIENT_DIR=${recordedBuiltDir}\n`);
  const recordedUninstallDryRun = runScript('scripts/uninstall.sh', ['--dry-run'], { env: { ...process.env, BLUENOTE_CONFIG_HOME: uninstallConfigHome } });
  assert.equal(recordedUninstallDryRun.status, 0, recordedUninstallDryRun.stderr);
  assert.match(recordedUninstallDryRun.stdout, new RegExp(escapeRegExp(path.join(recordedBuiltDir, 'bluenote-term'))));

  const xdgConfigHome = makeTempDir('uninstall-xdg-config-home');
  const xdgConfigDir = path.join(xdgConfigHome, 'bluenote');
  fs.mkdirSync(xdgConfigDir, { recursive: true });
  fs.writeFileSync(path.join(xdgConfigDir, 'client-mode.env'), `BLUENOTE_CLIENT_MODE=built\nBLUENOTE_BUILT_CLIENT_DIR=${recordedBuiltDir}\n`);
  const xdgPurgeDryRun = runScript('scripts/uninstall.sh', ['--purge-config', '--dry-run'], { env: { ...process.env, XDG_CONFIG_HOME: xdgConfigHome } });
  assert.equal(xdgPurgeDryRun.status, 0, xdgPurgeDryRun.stderr);
  assert.match(xdgPurgeDryRun.stdout, new RegExp(escapeRegExp(path.join(xdgConfigHome, 'bluenote'))));

  const purgeWithoutPhrase = runScript('scripts/uninstall.sh', ['--purge-data', '--dry-run']);
  assert.notEqual(purgeWithoutPhrase.status, 0);
  assert.match(purgeWithoutPhrase.stderr, /requires exact confirmation: delete my bluenote data/);
  const purgeWrongPhrase = runScript('scripts/uninstall.sh', ['--purge-data', '--confirm', 'Delete my bluenote data', '--dry-run']);
  assert.notEqual(purgeWrongPhrase.status, 0);
  assert.match(purgeWrongPhrase.stderr, /requires exact confirmation: delete my bluenote data/);
  const purgeConfirmed = runScript('scripts/uninstall.sh', ['--purge-data', '--confirm', 'delete my bluenote data', '--dry-run']);
  assert.equal(purgeConfirmed.status, 0, purgeConfirmed.stderr);
  assert.match(purgeConfirmed.stdout, /Purge-data confirmed by exact typed phrase/);

  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.match(readme, /\.\/scripts\/install\.sh --dry-run/);
  assert.match(readme, /\.\/scripts\/install\.sh --yes/);
  assert.match(readme, /\.\\scripts\\install\.ps1 -Interactive/);
  assert.match(readme, /\.\/scripts\/uninstall\.sh --dry-run/);
  assert.match(readme, /\.\\scripts\\uninstall\.ps1 -DryRun/);
  assert.doesNotMatch(readme, /Task 10 .*contract categories/i);
}

async function testDevVerifyLocalScriptsContract() {
  const verifySh = readScript('scripts/dev-verify-local.sh');
  const verifyPs = readScript('scripts/dev-verify-local.ps1');

  const workspaceRoot = path.resolve(__dirname, '..', '..');
  const requiredSiblingPaths = [
    path.join(workspaceRoot, 'bluenote-core', 'package.json'),
    path.join(workspaceRoot, 'bluenote-webui', 'package.json'),
  ];
  if (requiredSiblingPaths.some((requiredPath) => !fs.existsSync(requiredPath))) {
    process.stdout.write('SKIP dev verify local scripts contract: missing sibling checkout for bluenote-core or bluenote-webui\n');
    return;
  }

  assert.match(verifySh, /set -euo pipefail/);
  assert.match(verifySh, /--dry-run/);
  assert.match(verifySh, /--keep-temp/);
  assert.match(verifySh, /NPM_CONFIG_PREFIX|npm_prefix/);
  assert.match(verifySh, /NPM_CONFIG_CACHE|npm_cache/);
  assert.match(verifySh, /NPM_CONFIG_USERCONFIG|npm_config_file/);
  assert.match(verifySh, /BLUENOTE_CONFIG_HOME/);
  assert.match(verifySh, /BLUENOTE_DATA_HOME/);
  assert.match(verifySh, /BLUENOTE_CACHE_HOME/);
  assert.match(verifySh, /npm pack/);
  assert.match(verifySh, /npm install -g/);
  assert.ok(verifySh.indexOf('npm pack') < verifySh.indexOf('npm install -g'), 'shell verification should pack before install');
  assert.match(verifySh, /bluenote --help/);
  assert.match(verifySh, /bluenote version/);
  assert.match(verifySh, /bluenote doctor/);
  assert.match(verifySh, /bluenote daemon start/);
  assert.match(verifySh, /bluenote daemon status/);
  assert.match(verifySh, /bluenote daemon stop/);
  assert.match(verifySh, /daemon_started/);
  assert.match(verifySh, /trap .*cleanup/);
  assert.match(verifySh, /keep_temp/);
  assert.match(verifySh, /rm -rf/);

  assert.match(verifyPs, /param\s*\(/i);
  assert.match(verifyPs, /\[switch\]\s*\$DryRun/i);
  assert.match(verifyPs, /\[switch\]\s*\$KeepTemp/i);
  assert.match(verifyPs, /NPM_CONFIG_PREFIX|npmPrefix/);
  assert.match(verifyPs, /NPM_CONFIG_CACHE|npmCache/);
  assert.match(verifyPs, /NPM_CONFIG_USERCONFIG|npmUserConfig/);
  assert.match(verifyPs, /BLUENOTE_CONFIG_HOME/);
  assert.match(verifyPs, /BLUENOTE_DATA_HOME/);
  assert.match(verifyPs, /BLUENOTE_CACHE_HOME/);
  assert.match(verifyPs, /npm pack/);
  assert.match(verifyPs, /npm install -g/);
  assert.ok(verifyPs.indexOf('npm pack') < verifyPs.indexOf('npm install -g'), 'PowerShell verification should pack before install');
  assert.match(verifyPs, /bluenote --help/);
  assert.match(verifyPs, /bluenote version/);
  assert.match(verifyPs, /bluenote doctor/);
  assert.match(verifyPs, /bluenote daemon start/);
  assert.match(verifyPs, /bluenote daemon status/);
  assert.match(verifyPs, /bluenote daemon stop/);
  assert.match(verifyPs, /daemonStarted/);
  assert.match(verifyPs, /bluenote-core/);
  assert.match(verifyPs, /@lordierclaw\/bluenote-core/);
  assert.match(verifyPs, /finally/);
  assert.match(verifyPs, /Remove-Item/);

  const verifyDryRun = runScript('scripts/dev-verify-local.sh', ['--web', '--dry-run']);
  assert.equal(verifyDryRun.status, 0, verifyDryRun.stderr);
  assert.match(verifyDryRun.stdout, /npm pack/);
  assert.match(verifyDryRun.stdout, /npm install -g/);
  assert.match(verifyDryRun.stdout, /NPM_CONFIG_PREFIX=/);
  assert.match(verifyDryRun.stdout, /NPM_CONFIG_CACHE=/);
  assert.match(verifyDryRun.stdout, /NPM_CONFIG_USERCONFIG=/);
  assert.match(verifyDryRun.stdout, /BLUENOTE_CONFIG_HOME=/);
  assert.match(verifyDryRun.stdout, /BLUENOTE_DATA_HOME=/);
  assert.match(verifyDryRun.stdout, /BLUENOTE_CACHE_HOME=/);
  assert.match(verifyDryRun.stdout, /bluenote --help/);
  assert.match(verifyDryRun.stdout, /bluenote version/);
  assert.match(verifyDryRun.stdout, /bluenote doctor/);
  const startIndex = verifyDryRun.stdout.indexOf('bluenote daemon start');
  const statusIndex = verifyDryRun.stdout.indexOf('bluenote daemon status');
  const stopIndex = verifyDryRun.stdout.indexOf('bluenote daemon stop');
  assert.notEqual(startIndex, -1, 'dry-run should start daemon');
  assert.notEqual(statusIndex, -1, 'dry-run should check daemon status');
  assert.notEqual(stopIndex, -1, 'dry-run should stop daemon');
  assert.ok(startIndex < statusIndex && statusIndex < stopIndex, 'daemon flow should be start/status/stop');
  assert.match(verifyDryRun.stdout, /cleanup temp paths/);

  const keepTempDryRun = runScript('scripts/dev-verify-local.sh', ['--web', '--dry-run', '--keep-temp']);
  assert.equal(keepTempDryRun.status, 0, keepTempDryRun.stderr);
  assert.match(keepTempDryRun.stdout, /keeping temp paths/);
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
  assert.match(result.stdout, /Bun for source TUI: available/);
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

async function testClientRuntimeModeResolution() {
  const pathBin = makeTempDir('runtime-path-bin');
  const builtDir = makeTempDir('runtime-built-dir');
  const pathTerm = path.join(pathBin, 'bluenote-term');
  const builtTerm = path.join(builtDir, 'bluenote-term');
  writeExecutable(pathTerm);
  writeExecutable(builtTerm);

  assert.deepEqual(resolveClientCommand('bluenote-term', {
    env: { PATH: pathBin },
    platform: 'linux',
  }), { command: 'bluenote-term', path: pathTerm, mode: 'path' });

  assert.deepEqual(resolveClientCommand('bluenote-term', {
    env: { PATH: pathBin, BLUENOTE_BUILT_CLIENT_DIR: builtDir },
    platform: 'linux',
  }), { command: 'bluenote-term', path: builtTerm, mode: 'built' });

  assert.deepEqual(resolveClientCommand('bluenote-term', {
    clientMode: 'path',
    env: { PATH: pathBin, BLUENOTE_BUILT_CLIENT_DIR: builtDir },
    platform: 'linux',
  }), { command: 'bluenote-term', path: pathTerm, mode: 'path' });

  const configHome = makeTempDir('runtime-config-home');
  const configDir = path.join(configHome, 'bluenote');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'client-mode.env'), `BLUENOTE_CLIENT_MODE=built\nBLUENOTE_BUILT_CLIENT_DIR=${builtDir}\n`);
  assert.deepEqual(resolveClientCommand('bluenote-term', {
    env: { PATH: '', BLUENOTE_CONFIG_HOME: configHome },
    platform: 'linux',
  }), { command: 'bluenote-term', path: builtTerm, mode: 'built' });

  const xdgHome = makeTempDir('runtime-xdg-config-home');
  fs.mkdirSync(path.join(xdgHome, 'bluenote'), { recursive: true });
  fs.writeFileSync(path.join(xdgHome, 'bluenote', 'client-mode.env'), `BLUENOTE_CLIENT_MODE=built\nBLUENOTE_BUILT_CLIENT_DIR=${builtDir}\n`);
  assert.deepEqual(resolveClientCommand('bluenote-term', {
    env: { PATH: '', XDG_CONFIG_HOME: xdgHome },
    platform: 'linux',
  }), { command: 'bluenote-term', path: builtTerm, mode: 'built' });

  const appDataHome = makeTempDir('runtime-appdata-home');
  fs.mkdirSync(path.join(appDataHome, 'bluenote'), { recursive: true });
  fs.writeFileSync(path.join(appDataHome, 'bluenote', 'client-mode.env'), `BLUENOTE_CLIENT_MODE=built\nBLUENOTE_BUILT_CLIENT_DIR=${builtDir}\n`);
  assert.deepEqual(resolveClientCommand('bluenote-term', {
    env: { PATH: '', APPDATA: appDataHome },
    platform: 'win32',
  }), { command: 'bluenote-term', path: builtTerm, mode: 'built' });

  assert.equal(resolveClientCommand('bluenote-term', {
    clientMode: 'path',
    env: { PATH: '', BLUENOTE_CONFIG_HOME: configHome },
    platform: 'linux',
  }), undefined);

  assert.equal(resolveClientCommand('bluenote-term', {
    clientMode: 'built',
    env: { PATH: pathBin, BLUENOTE_BUILT_CLIENT_DIR: path.join(builtDir, 'missing') },
    platform: 'linux',
  }), undefined);
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
  assert.match(noClients.stdout, /Bun for source TUI: not found/);
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
  assert.match(found.stdout, /bluenote-webui: path/);
  assert.match(found.stdout, new RegExp(escapeRegExp(webPath)));
  assert.match(found.stdout, /version: 1\.3\.14/);
  assert.match(found.stdout, /bluenote-term: path/);
  assert.match(found.stdout, new RegExp(escapeRegExp(termPath)));
}

async function testDoctorReportsClientRuntimeModes() {
  const tempBin = makeTempDir('doctor-mode-path');
  const builtDir = makeTempDir('doctor-mode-built');
  const pathTerm = path.join(tempBin, 'bluenote-term');
  const builtTerm = path.join(builtDir, 'bluenote-term');
  writeExecutable(pathTerm);
  writeExecutable(builtTerm);

  const built = await runCli(['doctor'], {
    nodeVersion: '18.19.0',
    platform: 'linux',
    env: { ...process.env, PATH: tempBin, BLUENOTE_BUILT_CLIENT_DIR: builtDir },
    spawnSync(command) {
      assert.notEqual(command, 'bun', 'doctor should not require Bun when built TUI is available');
      return { status: 0, stdout: '2.0.0\n', stderr: '' };
    },
  });
  assert.equal(built.code, 0);
  assert.match(built.stdout, /bluenote-term: built/);
  assert.match(built.stdout, new RegExp(escapeRegExp(builtTerm)));
  assert.match(built.stdout, /Bun for source TUI: not required for built TUI/);

  const pathMode = await runCli(['doctor'], {
    nodeVersion: '18.19.0',
    platform: 'linux',
    env: { ...process.env, PATH: tempBin, BLUENOTE_BUILT_CLIENT_DIR: builtDir, BLUENOTE_CLIENT_MODE: 'path' },
    spawnSync(command) {
      if (command === 'bun') return { status: 1, stdout: '', stderr: '' };
      return { status: 0, stdout: '1.0.0\n', stderr: '' };
    },
  });
  assert.equal(pathMode.code, 0);
  assert.match(pathMode.stdout, /bluenote-term: path/);
  assert.match(pathMode.stdout, new RegExp(escapeRegExp(pathTerm)));

  const pathFlag = await runCli(['doctor', '--client-mode', 'path'], {
    nodeVersion: '18.19.0',
    platform: 'linux',
    env: { ...process.env, PATH: tempBin, BLUENOTE_BUILT_CLIENT_DIR: builtDir },
    spawnSync(command) {
      if (command === 'bun') return { status: 1, stdout: '', stderr: '' };
      return { status: 0, stdout: '1.0.0\n', stderr: '' };
    },
  });
  assert.equal(pathFlag.code, 0);
  assert.match(pathFlag.stdout, /bluenote-term: path/);
  assert.match(pathFlag.stdout, new RegExp(escapeRegExp(pathTerm)));

  let spawnCalled = false;
  const invalidMode = await runCli(['doctor'], {
    nodeVersion: '18.19.0',
    platform: 'linux',
    env: { ...process.env, PATH: tempBin, BLUENOTE_CLIENT_MODE: 'builtin' },
    spawnSync() {
      spawnCalled = true;
      return { status: 0, stdout: 'should-not-run\n', stderr: '' };
    },
  });
  assert.equal(invalidMode.code, 1);
  assert.match(invalidMode.stderr, /Invalid BLUENOTE_CLIENT_MODE "builtin"/);
  assert.equal(spawnCalled, false);

  spawnCalled = false;
  const invalidFlag = await runCli(['doctor', '--client-mode=builtin'], {
    nodeVersion: '18.19.0',
    platform: 'linux',
    env: { ...process.env, PATH: tempBin, BLUENOTE_BUILT_CLIENT_DIR: builtDir },
    spawnSync() {
      spawnCalled = true;
      return { status: 0, stdout: 'should-not-run\n', stderr: '' };
    },
  });
  assert.equal(invalidFlag.code, 1);
  assert.match(invalidFlag.stderr, /Invalid --client-mode "builtin"/);
  assert.equal(spawnCalled, false);
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

async function testDoctorReportsHandshakeFailureWithoutMarkingClientBroken() {
  const tempBin = makeTempDir('doctor-handshake-failure');
  const webPath = path.join(tempBin, 'bluenote-webui.CMD');
  writeExecutable(webPath);
  const { root, env } = makeDaemonEnv();
  try {
    const started = await runCli(['daemon', 'start'], { env });
    assert.equal(started.code, 0);
    const calls = [];
    const found = await runCli(['doctor'], {
      nodeVersion: '18.19.0',
      platform: 'win32',
      env: { ...env, PATH: tempBin, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
      spawnSync(command, args, options) {
        calls.push({ command, args, options });
        if (command === 'bun') return { status: 1, stdout: '', stderr: '' };
        if (args.includes('--version')) return { status: 0, stdout: '0.4.2\n', stderr: '' };
        if (args.includes('--check-daemon')) return { status: 1, stdout: '', stderr: 'handshake failed' };
        return { status: 1, stdout: '', stderr: 'unexpected' };
      },
    });
    assert.equal(found.code, 0);
    assert.match(found.stdout, /bluenote-webui: path/);
    assert.match(found.stdout, /daemon handshake: failed/);
    assert.equal(calls.some((call) => call.command === webPath && call.options.shell === true), true);
  } finally {
    await runCli(['daemon', 'stop'], { env });
    fs.rmSync(root, { recursive: true, force: true });
  }
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

async function testClientLaunchUsesBuiltAndPathModes() {
  const tempBin = makeTempDir('client-mode-path');
  const builtDir = makeTempDir('client-mode-built');
  const { root, env } = makeDaemonEnv();
  try {
    const pathTerm = path.join(tempBin, 'bluenote-term');
    const builtTerm = path.join(builtDir, 'bluenote-term');
    writeExecutable(pathTerm);
    writeExecutable(builtTerm);
    const started = await runCli(['daemon', 'start'], { env });
    assert.equal(started.code, 0);
    const calls = [];
    function spawn(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      process.nextTick(() => child.emit('exit', 0));
      return child;
    }

    const built = await runCli(['tui', '--smoke'], { env: { ...env, PATH: tempBin, BLUENOTE_BUILT_CLIENT_DIR: builtDir }, spawn });
    assert.equal(built.code, 0);
    assert.equal(calls[0].command, builtTerm);
    assert.deepEqual(calls[0].args, ['--smoke']);

    const pathMode = await runCli(['tui', '--client-mode', 'path', '--smoke'], { env: { ...env, PATH: tempBin, BLUENOTE_BUILT_CLIENT_DIR: builtDir }, spawn });
    assert.equal(pathMode.code, 0);
    assert.equal(calls[1].command, pathTerm);
    assert.deepEqual(calls[1].args, ['--smoke']);
  } finally {
    await runCli(['daemon', 'stop'], { env });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testBuiltModeMissingClientMessage() {
  const { root, env } = makeDaemonEnv();
  try {
    const started = await runCli(['daemon', 'start'], { env });
    assert.equal(started.code, 0);
    const result = await runCli(['tui'], { env: { ...env, PATH: '', BLUENOTE_CLIENT_MODE: 'built', BLUENOTE_BUILT_CLIENT_DIR: path.join(root, 'missing-built') } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Built client bluenote-term was not found/);
    assert.match(result.stderr, /BLUENOTE_BUILT_CLIENT_DIR/);
    assert.match(result.stderr, /--client-mode path/);
  } finally {
    await runCli(['daemon', 'stop'], { env });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testClientModeValidation() {
  const tempBin = makeTempDir('client-mode-validation');
  const { root, env } = makeDaemonEnv();
  try {
    writeExecutable(path.join(tempBin, 'bluenote-term'));
    const started = await runCli(['daemon', 'start'], { env });
    assert.equal(started.code, 0);
    let spawnCalled = false;
    function spawn() {
      spawnCalled = true;
      throw new Error('invalid mode should not spawn client');
    }

    const invalidFlag = await runCli(['tui', '--client-mode=builtin', '--smoke'], { env: { ...env, PATH: tempBin }, spawn });
    assert.equal(invalidFlag.code, 1);
    assert.match(invalidFlag.stderr, /Invalid --client-mode "builtin"/);
    assert.match(invalidFlag.stderr, /auto, path, or built/);

    const missingValue = await runCli(['tui', '--client-mode', '--smoke'], { env: { ...env, PATH: tempBin }, spawn });
    assert.equal(missingValue.code, 1);
    assert.match(missingValue.stderr, /Missing value for --client-mode/);
    assert.match(missingValue.stderr, /auto, path, or built/);

    const invalidEnv = await runCli(['tui', '--smoke'], { env: { ...env, PATH: tempBin, BLUENOTE_CLIENT_MODE: 'builtin' }, spawn });
    assert.equal(invalidEnv.code, 1);
    assert.match(invalidEnv.stderr, /Invalid BLUENOTE_CLIENT_MODE "builtin"/);
    assert.equal(spawnCalled, false);
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
  testReadmeStructureContract,
  testDevLocalScriptsContract,
  testReleaseWorkflowSiblingCheckoutContract,
  testInstallerPreflightContract,
  testDevVerifyLocalScriptsContract,
  testHelpDoesNotLoadClients,
  testVersionDoesNotLoadClients,
  testDoctorDoesNotLoadClients,
  testCommandDiscovery,
  testClientRuntimeModeResolution,
  testDoctorReportsOptionalClients,
  testDoctorReportsBrokenClients,
  testDoctorReportsHandshakeFailureWithoutMarkingClientBroken,
  testDoctorReportsClientRuntimeModes,
  testUnknownCommand,
  testDaemonLifecycle,
  testDaemonStartDoesNotExposeTokenInArgv,
  testStaleDaemonMetadata,
  testClientLaunchRequiresDaemon,
  testClientLaunchUsesPathAndDaemonEnv,
  testClientLaunchUsesBuiltAndPathModes,
  testBuiltModeMissingClientMessage,
  testClientModeValidation,
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
