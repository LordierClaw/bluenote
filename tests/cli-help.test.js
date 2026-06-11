const assert = require('assert').strict;

const { run } = require('../src/cli.js');

async function testHelp() {
  const stdout = [];
  const stderr = [];

  const result = await run(['--help'], {
    stdout: { write: (chunk) => stdout.push(String(chunk)) },
    stderr: { write: (chunk) => stderr.push(String(chunk)) },
  });

  assert.equal(result, 0);
  assert.equal(stderr.join(''), '');

  const help = stdout.join('');
  assert.match(help, /Usage: bluenote \[command\] \[options\]/);
  assert.match(help, /Commands:/);
  assert.match(help, /tui/);
  assert.match(help, /web/);
  assert.match(help, /daemon/);
  assert.match(help, /doctor/);
  assert.match(help, /version/);
}

testHelp()
  .then(() => {
    console.log('cli-help.test.js: ok');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
