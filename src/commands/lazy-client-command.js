'use strict';

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

function getCommandApi(moduleNamespace, supportedApiNames) {
  for (const exportName of supportedApiNames) {
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

function writeLoadError(streams, packageName, commandName) {
  const stderr = streams.stderr || process.stderr;
  write(stderr, `Unable to load ${packageName} for \`bluenote ${commandName}\`.\n`);
  write(stderr, `Install the public ${packageName} package and ensure it exposes a public command API.\n`);
}

function writeApiError(streams, packageName, commandName, supportedApiNames) {
  const stderr = streams.stderr || process.stderr;
  write(stderr, `${packageName} does not export a supported command API for \`bluenote ${commandName}\`.\n`);
  write(stderr, `Expected one of: ${supportedApiNames.join(', ')}.\n`);
}

function clientIoFor(streams) {
  const clientIo = Object.assign({}, streams);
  delete clientIo.clientLoader;
  return clientIo;
}

function createLazyClientCommand(options) {
  const packageName = options.packageName;
  const commandName = options.commandName;
  const supportedApiNames = options.supportedApiNames;

  async function run(args, io) {
    const argv = Array.isArray(args) ? args : [];
    const streams = io || {};
    const loader = streams.clientLoader || defaultClientLoader;
    let clientModule;

    try {
      clientModule = await loader(packageName);
    } catch (error) {
      if (isModuleLoadError(error)) {
        writeLoadError(streams, packageName, commandName);
        return 1;
      }

      throw error;
    }

    const commandApi = getCommandApi(clientModule, supportedApiNames);
    if (!commandApi) {
      writeApiError(streams, packageName, commandName, supportedApiNames);
      return 1;
    }

    return commandApi(argv, clientIoFor(streams));
  }

  return { run };
}

module.exports = {
  createLazyClientCommand,
};
