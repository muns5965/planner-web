#!/usr/bin/env node
// Dependency-free, source-preserving single-HTML bundler for the project's ES modules.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = path => readFile(resolve(root, path), 'utf8');
const moduleOrder = [
  'validator.js', 'storage.js', 'tasks.js',
  'dates-trash.js', 'editor.js', 'ui.js'
];
const importPattern = /import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/([^'"]+)['"]\s*;?/g;
const exportPattern = /\bexport\s+(?=(?:async\s+)?(?:function|const|let|class)\s)/g;

async function generate() {
  const [html, css] = await Promise.all([src('index.html'), src('src/styles.css')]);
  let combined = "/* Franklin Planner: locally bundled, schema v1 */\n";
  combined += "const __plannerModules = Object.create(null);\n";
  for (const filename of moduleOrder) {
    const source = await src('src/' + filename);
    const declared = [...source.matchAll(/\bexport\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)]
      .map(match => match[1]);
    let imports = '';
    let replaced = source.replace(importPattern, (_, fields, dependency) => {
      if (!moduleOrder.includes(dependency) || moduleOrder.indexOf(dependency) >= moduleOrder.indexOf(filename)) {
        throw Error('Unsupported or circular dependency in ' + filename + ': ' + dependency);
      }
      imports += "const {" + fields.replace(/\bas\b/g, ':') + "} = __plannerModules[" + JSON.stringify(dependency) + "];\n";
      return '';
    });
    if (/\b(?:import|export)\s*(?:\{|from|default|\*)/.test(replaced.replace(exportPattern, ''))) {
      throw Error('Unsupported module syntax in ' + filename);
    }
    replaced = replaced.replace(exportPattern, '');
    combined += "\n// " + filename + "\n__plannerModules[" + JSON.stringify(filename) +
      "] = (() => {\n" + imports + replaced + "\nreturn {" + declared.join(',') + "};\n})();\n";
  }
  if (/<\/script/i.test(combined) || /<\/style/i.test(css)) {
    throw Error('Unsafe literal closing tag in source; escape before bundling');
  }
  const stylesheet = '<link rel="stylesheet" href="./src/styles.css">';
  const entry = '<script type="module" src="./src/ui.js"></script>';
  if (html.split(stylesheet).length !== 2 || html.split(entry).length !== 2) {
    throw Error('HTML stylesheet or module entrypoint not found exactly once');
  }
  const result = html.replace(stylesheet, '<style>\n' + css + '\n</style>')
    .replace(entry, '<script type="module">\n' + combined + '\n</script>');
  if (/src="\.\/src\/|href="\.\/src\//.test(result)) throw Error('Unbundled asset reference remains');
  await mkdir(resolve(root, 'dist'), {recursive:true});
  await writeFile(resolve(root, 'dist/franklin-planner.html'), result, 'utf8');
  console.log('Built dist/franklin-planner.html (' + Buffer.byteLength(result) + ' bytes)');
}
await generate();
