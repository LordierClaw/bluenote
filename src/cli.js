'use strict';

const versionCommand = require('./commands/version.js');
const doctorCommand = require('./commands/doctor.js');
const tuiCommand = require('./commands/tui.js');
const webCommand = require('./commands/web.js');
const daemonCommand = require('./commands/daemon.js');

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

const COMMANDS = ['tui', 'web', 'daemon', 'doctor', 'version'];

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

  if (argv[0] === 'version') {
    return versionCommand.run(argv.slice(1), streams);
  }

  if (argv[0] === 'doctor') {
    return doctorCommand.run(argv.slice(1), streams);
  }

  if (argv[0] === 'tui') {
    return tuiCommand.run(argv.slice(1), streams);
  }

  if (argv[0] === 'web') {
    return webCommand.run(argv.slice(1), streams);
  }

  if (argv[0] === 'daemon') {
    return daemonCommand.run(argv.slice(1), streams);
  }

  if (COMMANDS.indexOf(argv[0]) !== -1) {
    write(streams.stderr || process.stderr, `Command not implemented yet: ${argv[0]}\n`);
    return 1;
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
  COMMANDS,
  HELP_TEXT,
  main,
  run,
};
