'use strict';

const { createLazyClientCommand } = require('./lazy-client-command.js');

const PACKAGE_NAME = 'bluenote-webui';
const COMMAND_NAME = 'web';
const SUPPORTED_API_NAMES = ['runWebCommand', 'runCommand'];

const command = createLazyClientCommand({
  packageName: PACKAGE_NAME,
  commandName: COMMAND_NAME,
  supportedApiNames: SUPPORTED_API_NAMES,
});

module.exports = {
  PACKAGE_NAME,
  SUPPORTED_API_NAMES,
  run: command.run,
};
