#!/usr/bin/env node
/** Generate a compact factory manifest from the factory modules themselves.
 * The JavaScript schemas remain the only API source of truth.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir, access } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)) , '..');
const factoryDir = resolve(root, 'assets/world/object/factory');
const args = process.argv.slice(2);
const outputAt = args.indexOf('--output');
const output = outputAt >= 0 ? resolve(args[outputAt + 1]) : null;
const optionsAt = args.indexOf('--options');
const requested = args.indexOf('--factory') >= 0 ? args[args.indexOf('--factory') + 1] : null;

const hash = data => createHash('sha256').update(data).digest('hex');
const jsonValue = value => {
  if (typeof value === 'function') return 'conditional';
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonValue(v)]));
  return value;
};
const typeOf = spec => spec.choices ? 'choice' : spec.min !== undefined || spec.max !== undefined ? 'number' : typeof spec.default;
const slug = name => name.replace(/VisualFactory\.js$/, '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
// Normalizers resolve values but may ignore unknown keys. Compare against their
// real output shape instead of maintaining another allowlist in the manifest.
const rejectUnknown = (input, resolved, path = '') => {
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(resolved, key)) throw new Error(`unknown option: ${path}${key}`);
    if (value && typeof value === 'object' && !Array.isArray(value)
        && resolved[key] && typeof resolved[key] === 'object') {
      rejectUnknown(value, resolved[key], `${path}${key}.`);
    }
  }
};

let files = (await readdir(factoryDir)).filter(name => name.endsWith('VisualFactory.js')).sort();
if (requested) {
  const exact = files.filter(name => name.toLowerCase() === `${requested.toLowerCase()}.js`);
  files = exact.length ? exact : files.filter(name => name.toLowerCase().includes(requested.toLowerCase()));
  if (files.length !== 1) {
    console.error(`error: ${files.length ? 'ambiguous' : 'unknown'} factory: ${requested}`);
    process.exit(2);
  }
}
if (optionsAt >= 0 && !requested) { console.error('error: --options requires --factory'); process.exit(2); }
const factories = [];
for (const file of files) {
  const sourcePath = resolve(factoryDir, file);
  const source = await readFile(sourcePath, 'utf8');
  let mod = {};
  try { mod = await import(pathToFileURL(sourcePath)); } catch (error) {
    if (optionsAt >= 0) { console.error(`error: ${error.message}`); process.exit(1); }
    factories.push({name: file.replace(/\.js$/, ''), source: `assets/world/object/factory/${file}`, sourceSha256: hash(source), status: 'unavailable', reason: String(error.message)});
    continue;
  }
  const schemaName = Object.keys(mod).find(key => key.endsWith('_SCHEMA'));
  const presetName = Object.keys(mod).find(key => key.endsWith('_PRESETS'));
  const normalizeName = Object.keys(mod).find(key => /^normalize.*Options$/.test(key));
  const factoryName = Object.keys(mod).find(key => /^create.*Visual$/.test(key))
    ?? Object.keys(mod).find(key => /^build.*Visual$/.test(key));
  const imports = [...source.matchAll(/(?:from|import\s*\(|fetch\s*\()\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  const runtime = imports.filter(ref => ref.startsWith('.')).map(ref => relative(root, resolve(dirname(sourcePath), ref)).replaceAll('\\', '/'));
  if (optionsAt >= 0) {
    try {
      const options = JSON.parse(args[optionsAt + 1]);
      if (!options || Array.isArray(options) || typeof options !== 'object') throw new Error('options must be a JSON object');
      if (!normalizeName) throw new Error('factory has no normalizer');
      const normalized = mod[normalizeName](options);
      rejectUnknown(options, normalized);
      console.log(JSON.stringify({factory: file.replace(/\.js$/, ''), status: 'valid', options: normalized}));
      process.exit(0);
    } catch (error) { console.error(`error: ${error.message}`); process.exit(1); }
  }
  const schema = requested && schemaName ? jsonValue(mod[schemaName]) : null;
  const params = schema ? Object.fromEntries(Object.entries(schema).map(([key, spec]) => [key, {
    type: typeOf(spec), default: jsonValue(spec.default), ...(spec.min !== undefined ? {min: spec.min} : {}),
    ...(spec.max !== undefined ? {max: spec.max} : {}), ...(spec.step !== undefined ? {step: spec.step} : {}),
    ...(spec.choices ? {choices: Object.keys(spec.choices)} : {}), ...(spec.when ? {when: 'conditional'} : {})
  }])) : {};
  let apiDoc = `docs/api/${slug(file)}-visual-factory.md`;
  try { await access(resolve(root, apiDoc)); } catch { apiDoc = 'assets/catalogs/world-visuals.md'; }
  factories.push({name: file.replace(/\.js$/, ''), source: `assets/world/object/factory/${file}`, sourceSha256: hash(source),
    status: 'ready', constructor: factoryName || null, normalize: normalizeName || null,
    ...(requested ? {presets: presetName ? Object.keys(mod[presetName]) : [], params, runtimeDependencies: runtime} : {}),
    apiDoc});
}
const manifest = {format: 'gameblocks-factory-manifest/v1', generatedAt: new Date().toISOString(), source: 'factory exports', factories};
if (output) {
  await mkdir(dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify(manifest, null, 2) + '\n');
  console.log(output);
} else console.log(JSON.stringify(manifest));
