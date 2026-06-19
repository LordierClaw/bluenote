#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const packages = [
  {
    repoName: 'bluenote',
    packagePath: 'package.json',
    expectedName: '@lordierclaw/bluenote',
  },
  {
    repoName: 'bluenote-core',
    packagePath: 'package.json',
    expectedName: '@lordierclaw/bluenote-core',
  },
  {
    repoName: 'bluenote-webui',
    packagePath: 'package.json',
    expectedName: '@lordierclaw/bluenote-webui',
  },
  {
    repoName: 'bluenote-term',
    packagePath: path.join('packages', 'term', 'package.json'),
    expectedName: '@lordierclaw/bluenote-term',
  },
];

function parseArgs(argv) {
  const options = {
    allowGitDeps: false,
    workspaceRoot: path.resolve(repoRoot, '..'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--allow-git-deps') {
      options.allowGitDeps = true;
      continue;
    }
    if (arg === '--workspace-root') {
      const value = argv[index + 1];
      if (!value) throw new Error('--workspace-root requires a path');
      options.workspaceRoot = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`missing package: ${filePath}`);
    }
    throw new Error(`failed to read ${filePath}: ${error.message}`);
  }
}

function isSemver(version) {
  const numericIdentifier = '(?:0|[1-9]\\d*)';
  const prereleaseIdentifier = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
  const buildIdentifier = '[0-9A-Za-z-]+';
  return new RegExp(
    `^${numericIdentifier}\\.${numericIdentifier}\\.${numericIdentifier}`
      + `(?:-${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*)?`
      + `(?:\\+${buildIdentifier}(?:\\.${buildIdentifier})*)?$`,
  ).test(version);
}

function isExactSemver(version) {
  return isSemver(version);
}

function isLatestDependency(version) {
  return version === 'latest';
}

function dependencyEntries(packageJson) {
  return [
    ...Object.entries(packageJson.dependencies || {}),
    ...Object.entries(packageJson.devDependencies || {}),
    ...Object.entries(packageJson.optionalDependencies || {}),
    ...Object.entries(packageJson.peerDependencies || {}),
  ];
}

function isGitDependency(specifier) {
  return /^(?:git\+|github:|git:\/\/|https:\/\/github\.com\/)/.test(specifier) || /#[0-9a-f]{7,40}$/i.test(specifier);
}

function validatePackage(definition, packageJson, packagePath, options) {
  if (packageJson.name !== definition.expectedName) {
    throw new Error(`${packagePath}: expected ${definition.expectedName}, found ${packageJson.name || '<missing>'}`);
  }

  if (!isSemver(packageJson.version || '')) {
    throw new Error(`${packagePath}: invalid semver version ${packageJson.version || '<missing>'}`);
  }

  const coreDependency = packageJson.dependencies?.['@lordierclaw/bluenote-core'];
  if (
    definition.expectedName !== '@lordierclaw/bluenote-core'
    && typeof coreDependency === 'string'
    && !isGitDependency(coreDependency)
    && !isExactSemver(coreDependency)
    && !isLatestDependency(coreDependency)
  ) {
    throw new Error(
      `${packagePath}: ${definition.expectedName} must use latest, an exact semver, or a Git dependency for `
        + `@lordierclaw/bluenote-core; found ${coreDependency}.`,
    );
  }

  for (const [dependencyName, dependencyVersion] of dependencyEntries(packageJson)) {
    if (!dependencyName.startsWith('@lordierclaw/bluenote')) continue;
    if (typeof dependencyVersion !== 'string') continue;
    if (!isGitDependency(dependencyVersion)) continue;
    if (options.allowGitDeps) continue;
    throw new Error(
      `${packagePath}: Git dependency is not allowed in release mode: ${dependencyName}@${dependencyVersion}. `
        + 'Pass --allow-git-deps for local development checks.',
    );
  }
}

function loadPackages(options) {
  return packages.map((definition) => {
    const packagePath = path.join(options.workspaceRoot, definition.repoName, definition.packagePath);
    const packageJson = readJson(packagePath);
    validatePackage(definition, packageJson, packagePath, options);
    return {
      name: packageJson.name,
      version: packageJson.version,
    };
  });
}

function printTable(rows) {
  const nameWidth = rows.reduce((width, row) => Math.max(width, row.name.length), 0) + 2;
  console.log('BlueNote package versions');
  for (const row of rows) {
    console.log(`${row.name.padEnd(nameWidth)}${row.version}`);
  }
}

function printHelp() {
  console.log(`Usage: node scripts/version-status.mjs [options]\n\nOptions:\n  --workspace-root <path>  Parent directory containing sibling BlueNote repos\n  --allow-git-deps        Permit pinned Git dependencies for local development checks\n  -h, --help              Show this help`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }
  printTable(loadPackages(options));
} catch (error) {
  process.stderr.write(`${error && error.message ? error.message : error}\n`);
  process.exitCode = 1;
}
