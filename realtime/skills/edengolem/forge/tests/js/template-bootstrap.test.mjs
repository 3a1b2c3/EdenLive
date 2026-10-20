import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const html = await readFile(new URL('../../../assets/template/index.html', import.meta.url), 'utf8');
const shell = await readFile(new URL('../../../assets/user-interface/PrototypeShell.js', import.meta.url), 'utf8');
const bootstrap = html.replace(/<!--[\s\S]*?-->/g, '').match(/<script type="module">([\s\S]*?)<\/script>/)[1];

test('template CSS pins the play canvas to the #app box', () => {
  assert.match(html, /#app canvas \{[^}]*width:\s*100%;[^}]*height:\s*100%;/);
});

test('installResize sizes the drawing buffer without writing canvas CSS', () => {
  assert.match(shell, /setSize\(width, height, false\)/);
  assert.match(shell, /ResizeObserver/);
});

async function runBootstrap(loadMain) {
  const fatal = { style: { display: 'none' }, textContent: '' };
  const document = { getElementById: () => fatal };
  // Substitute only the module loader; execute the shipped error-handling chain.
  const source = bootstrap.replace("import('./main.js')", 'loadMain()');
  await new Function('loadMain', 'document', `return ${source.trim()}`)(loadMain, document);
  return fatal;
}

test('template accepts a synchronous start function', async () => {
  let started = false;
  const fatal = await runBootstrap(() => Promise.resolve({ start() { started = true; } }));
  assert.equal(started, true);
  assert.equal(fatal.style.display, 'none');
});

test('template reports module loading failures', async () => {
  const fatal = await runBootstrap(() => Promise.reject(new Error('module missing')));
  assert.equal(fatal.style.display, 'block');
  assert.match(fatal.textContent, /module missing/);
});

test('template reports synchronous and asynchronous startup failures', async () => {
  for (const start of [
    () => { throw new Error('sync startup'); },
    () => Promise.reject(new Error('async startup')),
  ]) {
    const fatal = await runBootstrap(() => Promise.resolve({ start }));
    assert.equal(fatal.style.display, 'block');
    assert.match(fatal.textContent, /startup/);
  }
});
