import {readFile, readdir, mkdir, copyFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const app = fileURLToPath(new URL('..', import.meta.url));
const source = fileURLToPath(new URL('../../../theme-source/assets/', import.meta.url));
const target = join(app, 'public', '__theme');
const assets = new Set();
function collect(text) {
  for (const match of text.matchAll(/\/__theme\/([\w.-]+)/g)) assets.add(match[1]);
}
async function scan(folder) {
  for (const entry of await readdir(folder, {withFileTypes: true})) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.(?:tsx?|css)$/.test(entry.name)) collect(await readFile(path, 'utf8'));
  }
}
for (const folder of ['app', 'components', 'lib']) await scan(join(app, folder));
collect(await readFile(new URL('../../../content/catalog.json', import.meta.url), 'utf8'));
await mkdir(target, {recursive: true});
for (const name of assets) {
  if (basename(name) !== name) throw Error('Ruta de recurso inválida');
  if (name.endsWith('.css')) {
    const css = await readFile(join(source, name), 'utf8');
    collect(css);
    for (const match of css.matchAll(/url\(\s*['"]?([\w.-]+)['"]?\s*\)/g)) assets.add(match[1]);
  }
  await copyFile(join(source, name), join(target, name));
}
console.log(`Checkout: ${assets.size} recursos locales preparados.`);
