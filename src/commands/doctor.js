'use strict';

const packageJson = require('../../package.json');

function write(stream, text) {
  if (stream && typeof stream.write === 'function') {
    stream.write(text);
  }
}

function parseVersion(version) {
  const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function parseBaseline(engine) {
  const match = String(engine || '').match(/^>=(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] || 0),
  };
}

function compareVersions(left, right) {
  if (left.major !== right.major) {
    return left.major > right.major ? 1 : -1;
  }

  if (left.minor !== right.minor) {
    return left.minor > right.minor ? 1 : -1;
  }

  if (left.patch !== right.patch) {
    return left.patch > right.patch ? 1 : -1;
  }

  return 0;
}

function satisfiesBaseline(nodeVersion, baseline) {
  const parsedNode = parseVersion(nodeVersion);
  const parsedBaseline = parseBaseline(baseline);

  if (!parsedNode || !parsedBaseline) {
    return false;
  }

  return compareVersions(parsedNode, parsedBaseline) >= 0;
}

async function run(args, io) {
  const streams = io || {};
  const nodeVersion = streams.nodeVersion || process.versions.node;
  const baseline = packageJson.engines && packageJson.engines.node ? packageJson.engines.node : '>=16.14';
  const supported = satisfiesBaseline(nodeVersion, baseline);

  write(streams.stdout || process.stdout, 'BlueNote doctor\n');
  write(streams.stdout || process.stdout, `Node version: ${nodeVersion}\n`);
  write(streams.stdout || process.stdout, `Distribution baseline: ${baseline}\n`);
  write(streams.stdout || process.stdout, `Node baseline: ${supported ? 'ok' : 'unsupported'}\n`);

  return supported ? 0 : 1;
}

module.exports = {
  parseVersion,
  satisfiesBaseline,
  run,
};
