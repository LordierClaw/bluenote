'use strict';

const PACKAGE_NAME = 'bluenote-webui';
const COMMAND_NAME = 'web';
const SUPPORTED_API_NAMES = ['runWebCommand', 'runCommand'];

function write(stream, text) {
  if (stream && typeof stream.write === 'function') {
    stream.write(text);
  }
}

async function defaultClientLoader(specifier) {
  return import(specifier);
}

function getExport(moduleNamespace, exportName) {
  if (moduleNamespace && typeof moduleNamespace[exportName] === 'function') {
    return moduleNamespace[exportName];
  }

  if (
    moduleNamespace &&
    moduleNamespace.default &&
    typeof moduleNamespace.default[exportName] === 'function'
  ) {
    return moduleNamespace.default[exportName];
  }

  return null;
}

function getCommandApi(moduleNamespace) {
  for (const exportName of SUPPORTED_API_NAMES) {
    const api = getExport(moduleNamespace, exportName);
    if (api) {
      return api;
    }
  }

  return null;
}

function isModuleLoadError(error) {
  return Boolean(
    error &&
      (error.code === 'ERR_MODULE_NOT_FOUND' ||
        error.code === 'MODULE_NOT_FOUND' ||
        /Cannot find (package|module)/.test(String(error.message || '')))
  );
}

function writeLoadError(streams, error) {
  const stderr = streams.stderr || process.stderr;
  write(stderr, `Unable to load ${PACKAGE_NAME} for \`bluenote ${COMMAND_NAME}\`.\n`);
  write(stderr, `Install the public ${PACKAGE_NAME} package and ensure it exposes a public command API.\n`);
  if (error && error.message) {
    write(stderr, `Cause: ${error.message}\n`);
  }
}

function writeApiError(streams) {
  const stderr = streams.stderr || process.stderr;
  write(stderr, `${PACKAGE_NAME} does not export a supported command API for \`bluenote ${COMMAND_NAME}\`.\n`);
  write(stderr, `Expected one of: ${SUPPORTED_API_NAMES.join(', ')}.\n`);
}

async function run(args, io) {
  const argv = Array.isArray(args) ? args : [];
  const streams = io || {};
  const loader = streams.clientLoader || defaultClientLoader;
  let clientModule;

  try {
    clientModule = await loader(PACKAGE_NAME);
  } catch (error) {
    if (isModuleLoadError(error)) {
      writeLoadError(streams, error);
      return 1;
    }

    throw error;
  }

  const commandApi = getCommandApi(clientModule);
  if (!commandApi) {
    writeApiError(streams);
    return 1;
  }

  return commandApi(argv, streams);
}

module.exports = {
  PACKAGE_NAME,
  SUPPORTED_API_NAMES,
  run,
};
