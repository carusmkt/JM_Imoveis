const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { transformSync } = require('esbuild');

// Exercise the real React input and event handlers, independently of the goo's
// rendering clock. Login must never need a timer or animation frame to finish.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false });
global.requestAnimationFrame = () => 1;
global.cancelAnimationFrame = () => {};
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const componentPath = path.join(__dirname, '../admin/components/OneTimeCode.tsx');
const compiled = transformSync(readFileSync(componentPath, 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' });
const componentModule = new Module(componentPath, module);
componentModule.filename = componentPath;
componentModule.paths = module.paths;
componentModule._compile(compiled.code, componentPath);
const { OneTimeCode } = componentModule.exports;

let root;
async function mount(verify = value => value === '12345678', initialValue = '') {
  document.body.innerHTML = '<div id="test-root"></div>';
  let opened = 0;
  root = createRoot(document.getElementById('test-root'));
  await act(async () => root.render(React.createElement(OneTimeCode, { length: 8, initialValue, verify, onVerified: () => opened++ })));
  return { get opened() { return opened; }, get input() { return document.getElementById('pin-gate-input'); } };
}
afterEach(async () => { if (root) { await act(async () => root.unmount()); root = null; } });
function nativeValue(input, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
}
async function type(input, value) {
  await act(async () => {
    nativeValue(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

test('the correct PIN opens immediately without waiting for animation timers', async () => {
  const ui = await mount();
  for (let length = 1; length <= 8; length++) await type(ui.input, '12345678'.slice(0, length));
  assert.equal(ui.opened, 1);
});
test('a partial PIN entered before the animation bundle loads is preserved', async () => {
  const ui = await mount(undefined, '1234');
  assert.equal(ui.input.value, '1234');
  await type(ui.input, '12345678');
  assert.equal(ui.opened, 1);
});
test('a complete PIN autofilled before mounting opens without another keystroke', async () => {
  const ui = await mount(undefined, '12345678');
  assert.equal(ui.opened, 1);
});
test('a wrong PIN never blocks an immediate correction or erases the corrected value later', async () => {
  const ui = await mount();
  await type(ui.input, '12345670');
  assert.equal(ui.opened, 0);
  assert.equal(ui.input.readOnly, false);
  await type(ui.input, '1234567');
  await type(ui.input, '12345678');
  assert.equal(ui.opened, 1);
  assert.equal(ui.input.value, '12345678');
});
test('an obsolete verification cannot reject a newer correct PIN', async () => {
  const requests = new Map();
  const ui = await mount(value => new Promise(resolve => requests.set(value, resolve)));
  await type(ui.input, '00000000');
  assert.equal(ui.input.readOnly, false);
  await type(ui.input, '12345678');
  await act(async () => requests.get('12345678')(true));
  assert.equal(ui.opened, 1);
  await act(async () => requests.get('00000000')(false));
  assert.equal(ui.opened, 1);
  assert.equal(document.querySelector('.otp').dataset.phase, 'ok');
});
test('Enter reads the actual autofilled field even without an input event', async () => {
  const ui = await mount();
  nativeValue(ui.input, '12345678');
  await act(async () => ui.input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  assert.equal(ui.opened, 1);
});
test('the Enter button reads the current field after showing or hiding the PIN', async () => {
  const ui = await mount();
  await type(ui.input, '1234');
  await act(async () => document.querySelector('.otp-visibility-toggle').click());
  assert.equal(ui.input.type, 'text');
  await act(async () => document.querySelector('.otp-visibility-toggle').click());
  nativeValue(ui.input, '12345678');
  await act(async () => document.getElementById('pin-gate-btn').click());
  assert.equal(ui.opened, 1);
});
test('pasting a complete PIN normalizes spaces before applying the length limit', async () => {
  const ui = await mount();
  const paste = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '1234 5678' } });
  await act(async () => ui.input.dispatchEvent(paste));
  assert.equal(ui.opened, 1);
  assert.equal(ui.input.value, '12345678');
});
test('repeated submissions while verifying open once', async () => {
  let resolve;
  let checks = 0;
  const ui = await mount(() => { checks++; return new Promise(done => { resolve = done; }); });
  await type(ui.input, '12345678');
  await act(async () => {
    ui.input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    document.getElementById('pin-gate-btn').click();
  });
  assert.equal(checks, 1);
  await act(async () => resolve(true));
  assert.equal(ui.opened, 1);
});
test('a verifier failure allows a successful retry', async () => {
  let first = true;
  const ui = await mount(() => { if (first) { first = false; throw new Error('Temporary failure'); } return true; });
  await type(ui.input, '12345678');
  assert.equal(ui.opened, 0);
  assert.equal(ui.input.readOnly, false);
  await act(async () => document.getElementById('pin-gate-btn').click());
  assert.equal(ui.opened, 1);
});

const html = readFileSync(path.join(__dirname, '../admin.html'), 'utf8');
const gateScript = html.slice(html.indexOf('// PIN GATE:')).split('</script>')[0];
for (const failure of ['read', 'write']) {
  test(`session storage ${failure} failure cannot keep a correct login locked`, () => {
    const classes = new Set();
    const content = { inert: true };
    const bodyClasses = new Set(['pin-locked']);
    const context = {
      window: {},
      sessionStorage: {
        getItem() { if (failure === 'read') throw new Error('Storage blocked'); return null; },
        setItem() { if (failure === 'write') throw new Error('Storage full'); }
      },
      document: {
        body: { classList: { remove: value => bodyClasses.delete(value) } },
        getElementById(id) {
          if (id === 'pin-gate-overlay') return { classList: { add: value => classes.add(value) } };
          if (id === 'admin-content') return content;
          return { addEventListener() {} };
        }
      }
    };
    assert.doesNotThrow(() => vm.runInNewContext(gateScript, context));
    assert.doesNotThrow(() => context.window.jmUnlockAdmin());
    assert(classes.has('hidden'));
    assert.equal(content.inert, false);
    assert.equal(bodyClasses.has('pin-locked'), false);
  });
}
