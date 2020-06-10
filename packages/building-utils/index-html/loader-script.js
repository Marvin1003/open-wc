const Terser = require('terser');
const { cleanImportPath, polyfillFilename } = require('./utils');

/**
 * @typedef {import('./create-index-html').EntriesConfig} EntriesConfig
 */

/**
 * @typedef {import('./create-index-html').Polyfill} Polyfill
 */
const loadScriptFunction = `
  function loadScript(src, module) {
    return new Promise(function (resolve, reject) {
      document.head.appendChild(Object.assign(
        document.createElement('script'),
        { src: src, onload: resolve, onerror: reject },
        module ? { type: 'module' } : undefined
      ));
    });
  }\n\n`;

/**
 * @param {EntriesConfig} entries
 * @param {EntriesConfig} legacyEntries
 * @param {Polyfill[]} polyfills
 */
function createLoadScriptFunction(entries, legacyEntries, polyfills) {
  if (polyfills && polyfills.length > 0) {
    return loadScriptFunction;
  }

  if (entries.type === 'script' || (legacyEntries && legacyEntries.type === 'script')) {
    return loadScriptFunction;
  }

  return '';
}

const asArrayLiteral = arr => `[${arr.map(e => `'${e}'`).join(',')}]`;

const entryLoaderCreators = {
  script: files =>
    files.length === 1
      ? `loadScript('${files[0]}')`
      : `${asArrayLiteral(files)}.forEach(function (entry) { loadScript(entry); })`,
  module: (files, polyfillDynamicImport) => {
    const importFunction = polyfillDynamicImport === false ? 'import' : 'window.importShim';

    return files.length === 1
      ? `${importFunction}('${files[0]}')`
      : `${asArrayLiteral(files)}.forEach(function (entry) { ${importFunction}(entry); })`;
  },
  system: files =>
    files.length === 1
      ? `System.import('${files[0]}')`
      : `${asArrayLiteral(files)}.forEach(function (entry) { System.import(entry); })`,
};

/**
 * @param {EntriesConfig} entries
 * @param {EntriesConfig} legacyEntries
 * @param {string} publicPath
 */
function createEntriesLoaderFunction(entries, legacyEntries, publicPath) {
  const importPath = path => cleanImportPath(path, publicPath);

  if (!legacyEntries) {
    return `${entryLoaderCreators[entries.type](
      entries.files.map(importPath),
      entries.polyfillDynamicImport,
    )};`;
  }

  const load = entryLoaderCreators[entries.type](
    entries.files.map(importPath),
    entries.polyfillDynamicImport,
  );
  const loadLegacy = entryLoaderCreators[legacyEntries.type](legacyEntries.files.map(importPath));
  return `'noModule' in HTMLScriptElement.prototype ? ${load} : ${loadLegacy};`;
}

/**
 * @param {Polyfill[]} polyfills
 */
function createExecuteLoadEntries(polyfills) {
  if (polyfills && polyfills.length) {
    return 'polyfills.length ? Promise.all(polyfills).then(loadEntries) : loadEntries();';
  }
  return 'loadEntries()';
}

/**
 * @param {EntriesConfig} entries
 * @param {EntriesConfig} legacyEntries
 * @param {Polyfill[]} polyfills
 * @param {string} publicPath
 */
function createEntriesLoader(entries, legacyEntries, polyfills, publicPath) {
  const loadEntriesFunction = createEntriesLoaderFunction(entries, legacyEntries, publicPath);
  const executeLoadEntries = createExecuteLoadEntries(polyfills);

  return `
  function loadEntries() {
    ${loadEntriesFunction}
  }

  ${executeLoadEntries}
`;
}

/**
 * @param {import('@open-wc/building-utils/index-html/create-index-html').Polyfill[]} polyfills
 * @param {import('@open-wc/building-utils/index-html/create-index-html').PolyfillsConfig} polyfillsConfig
 * @param {string} publicPath
 */
function createPolyfillsLoader(polyfills, polyfillsConfig, publicPath) {
  if (!polyfills) {
    return '';
  }

  let code = '  var polyfills = [];\n';

  polyfills.forEach(polyfill => {
    if (!polyfill.test) {
      return;
    }

    code += `  if (${
      polyfill.test
    }) { polyfills.push(loadScript('${publicPath}polyfills/${polyfillFilename(
      polyfill,
      polyfillsConfig,
    )}.js', ${Boolean(polyfill.module)})) }\n`;
  });

  return code;
}

/**
 * Creates a loader script that executed immediately.
 *
 * @param {EntriesConfig} entries
 * @param {EntriesConfig} legacyEntries
 * @param {import('@open-wc/building-utils/index-html/create-index-html').Polyfill[]} polyfills
 * @param {import('@open-wc/building-utils/index-html/create-index-html').PolyfillsConfig} polyfillsConfig
 * @param {string} publicPath
 */
function createLoaderScript(
  entries,
  legacyEntries,
  polyfills,
  polyfillsConfig,
  minified = true,
  publicPath,
) {
  /* eslint-disable prefer-template */
  const code =
    '(function() {' +
    createLoadScriptFunction(entries, legacyEntries, polyfills) +
    createPolyfillsLoader(polyfills, polyfillsConfig, publicPath) +
    createEntriesLoader(entries, legacyEntries, polyfills, publicPath) +
    '})();';

  return minified ? Terser.minify(code).code : code;
}

/**
 * Creates a function that only loads polyfills, deferring entry loader to the caller
 * @param {import('@open-wc/building-utils/index-html/create-index-html').Polyfill[]} polyfills
 * @param {import('@open-wc/building-utils/index-html/create-index-html').PolyfillsConfig} polyfillsConfig
 * @param {string} funcName
 * @param {string} publicPath
 */
function createPolyfillsLoaderScript(
  polyfills,
  polyfillsConfig,
  funcName = 'loadPolyfills',
  publicPath,
) {
  return (
    `function ${funcName}() {` +
    loadScriptFunction +
    createPolyfillsLoader(polyfills, polyfillsConfig, publicPath) +
    'return Promise.all(polyfills);\n' +
    '}'
  );
}

module.exports = {
  createLoaderScript,
  createPolyfillsLoaderScript,
};
