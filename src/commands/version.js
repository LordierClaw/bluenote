'use strict';

const packageJson = require('../../package.json');

function write(stream, text) {
  if (stream && typeof stream.write === 'function') {
    stream.write(text);
  }
}

async function run(args, io) {
  const streams = io || {};
  write(streams.stdout || process.stdout, `${packageJson.version}\n`);
  return 0;
}

module.exports = {
  run,
};