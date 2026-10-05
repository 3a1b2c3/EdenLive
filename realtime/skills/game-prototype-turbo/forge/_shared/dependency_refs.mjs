// Parse source without executing it. Unsupported loaders make reuse conservative.
import { parse } from 'acorn';
import { readFileSync } from 'node:fs';

const sources = JSON.parse(readFileSync(0, 'utf8'));
const loaders = new Set(['fetch', 'require', 'URL', 'Worker', 'SharedWorker', 'Audio']);
const ambient = new Set(['eval', 'Function', 'process', 'localStorage', 'sessionStorage',
  'indexedDB', 'caches', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'Reflect',
  'serviceWorker', 'sendBeacon', 'importScripts', 'FileReader']);
const results = sources.map(({ id, text }) => {
  const refs = [], uncertain = [];
  function reference(node) {
    if (node?.type === 'Literal' && typeof node.value === 'string') refs.push(node.value);
    else uncertain.push('computed resource reference');
  }
  function walk(node, parent) {
    if (!node || typeof node !== 'object') return;
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)
        && node.source) reference(node.source);
    if (node.type === 'ImportExpression') reference(node.source);
    if (['CallExpression', 'NewExpression'].includes(node.type)) {
      const name = node.callee?.name ?? node.callee?.property?.name;
      if (loaders.has(name)) {
        // new Worker(new URL('./worker.js', import.meta.url)) is statically resolvable.
        if (!(name.endsWith('Worker') && node.arguments[0]?.callee?.name === 'URL')) reference(node.arguments[0]);
        // Runtime URLs may be relative to the document, worker or a custom base;
        // request observation is insufficient to prove unvisited loader branches.
        uncertain.push(`runtime resource loader: ${name}`);
      }
      if (/^(?:load|loadAsync|readFile|readFileSync|createReadStream|open|insertRule|insertAdjacentHTML|write|writeln)$/.test(name)
          || /Loader$/.test(name)) uncertain.push(`unanalysed loader: ${name}`);
      if (['setAttribute', 'setAttributeNS'].includes(name)) {
        const key = node.arguments[0]?.value;
        if (typeof key !== 'string') uncertain.push('computed DOM attribute');
        else if (['src', 'href', 'srcset', 'style'].includes(key)) uncertain.push('runtime DOM resource');
      }
    }
    if (node.type === 'Identifier' && (ambient.has(node.name)
        || (loaders.has(node.name) && parent?.callee !== node && parent?.property !== node))) {
      uncertain.push(`ambient or aliased loader: ${node.name}`);
    }
    if (node.type === 'MemberExpression' && ['load', 'loadAsync', 'readFile', 'readFileSync', 'importScripts'].includes(node.property.name ?? node.property.value)) {
      uncertain.push('resource method or alias');
    }
    if (node.type === 'MemberExpression' && node.computed && node.property.type !== 'Literal'
        && (parent?.callee === node || parent?.left === node
            || ['window', 'globalThis', 'document', 'navigator'].includes(node.object.name))) {
      // Could name a loader, DOM resource property or environment value.
      uncertain.push('computed property access');
    }
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression') {
      const name = node.left.property.name ?? node.left.property.value;
      if (['src', 'href', 'srcset'].includes(name)) {
        reference(node.right);
        uncertain.push('runtime URL assignment');
      }
      if (['innerHTML', 'outerHTML'].includes(name)) uncertain.push('runtime HTML');
      // A Three.js scene commonly assigns `scene.background = new Color(...)`;
      // treating every `background` property as CSS would make every browser
      // snapshot uncertain and defeat safe reuse.  Restrict the broad
      // `background` case to an object whose owner is explicitly `.style` (or
      // a variable named style).  CSS resource properties remain conservative.
      const styleOwner = node.left.object?.property?.name === 'style'
        || node.left.object?.name === 'style';
      const cssProperty = ['cssText', 'backgroundImage', 'mask', 'maskImage', 'content', 'cursor'].includes(name)
        || (name === 'background' && styleOwner);
      if (cssProperty && !(node.right.type === 'Literal' && !String(node.right.value).includes('url('))) {
        uncertain.push('runtime CSS resource');
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) value.forEach(child => walk(child, node));
      else if (value && typeof value === 'object') walk(value, node);
    }
  }
  try { walk(parse(text, { ecmaVersion: 'latest', sourceType: 'module' })); }
  catch (error) { uncertain.push(`unsupported syntax: ${error.message}`); }
  return { id, refs: [...new Set(refs)], uncertain: [...new Set(uncertain)] };
});
process.stdout.write(JSON.stringify(results));
