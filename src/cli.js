'use strict';

const HELP_TEXT = `BlueNote distribution CLI

Usage: bluenote [command] [options]

Commands:
  tui       Launch the terminal interface
  web       Launch the web interface
  daemon    Show daemon command help
  doctor    Check distribution runtime availability
  version   Print the bluenote CLI version

Options:
  -h, --help  Show this help message
`;

function write(stream, text) {
  if (stream && typeof stream.write === 'function') {
    stream.write(text);
  }
}

async function run(args, io) {
  const argv = Array.isArray(args) ? args : [];
  const streams = io || {};
  const stdout = streams.stdout || process.stdout;

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    write(stdout, HELP_TEXT);
    return 0;
  }

  write(streams.stderr || process.stderr, `Unknown command: ${argv[0]}\nRun \"bluenote --help\" for usage.\n`);
  return 1;
}

async function main(args, io) {
  const exitCode = await run(args, io);
  process.exitCode = exitCode;
  return exitCode;
}

module.exports = {
  HELP_TEXT,
  main,
  run,
};
