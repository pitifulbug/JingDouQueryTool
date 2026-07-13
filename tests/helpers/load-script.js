'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
let exportSequence = 0;

function loadScript(relativePath, exportNames, globals = {}) {
  Object.assign(globalThis, globals);

  const filename = path.join(root, relativePath);
  const exportKey = `__jdBeanTestExports${++exportSequence}`;
  const source = fs.readFileSync(filename, 'utf8');
  const exportExpression = exportNames.join(', ');
  vm.runInThisContext(
    `${source}\n;globalThis[${JSON.stringify(exportKey)}] = { ${exportExpression} };`,
    { filename }
  );

  const exports = globalThis[exportKey];
  delete globalThis[exportKey];
  return exports;
}

module.exports = { loadScript };
