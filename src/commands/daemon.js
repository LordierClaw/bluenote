'use strict';

const HELP_TEXT = `BlueNote daemon command scaffold

Usage: bluenote daemon [--help]

This command name is reserved for a future BlueNote daemon.
The daemon/runtime/sync protocol is not implemented yet and requires a future cross-repo design before runtime work begins.

Options:
  -h, --help  Show this help message
`;

const SCAFFOLD_TEXT = 'bluenote daemon is a scaffold only; daemon/runtime/sync protocol is not implemented yet and requires a future cross-repo design.\nRun "bluenote daemon --help" for details.\n';

function write(stream, text) {
  if (stream && typeof stream.write === 'function') {
    stream.write(text);
  }
}

async function run(args, io) {
  const argv = Array.isArray(args) ? args : [];
  const streams = io || {};

  if (argv[0] === '--help' || argv[0] === '-h') {
    write(streams.stdout || process.stdout, HELP_TEXT);
    return 0;
  }

  write(streams.stderr || process.stderr, SCAFFOLD_TEXT);
  return 1;
}

module.exports = {
  HELP_TEXT,
  SCAFFOLD_TEXT,
  run,
};
