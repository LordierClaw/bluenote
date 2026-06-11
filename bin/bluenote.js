#!/usr/bin/env node

'use strict';

const { main } = require('../src/cli.js');

main(process.argv.slice(2)).catch((error) => {
  const message = error && error.message ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
