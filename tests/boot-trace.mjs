import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const read = file => fs.readFileSync(root + file, 'utf8');
const launcher = read('/image/airootfs/usr/local/bin/koya-installer');
const run = read('/run.sh');
const installer = read('/apps/installer.js');

assert.match(launcher, /systemd-cat --identifier=koya-installer[\s\S]*flock --nonblock/);
assert.match(launcher, /KOYA_INSTALLER_BOOT_TRACE=1[\s\S]*\/opt\/koya-installer\/run\.sh --verbose ui,layout,wayland,vulkan/);
assert.match(run, /--verbose\)/);
assert.match(installer, /!preview && Process\.getEnv\('KOYA_INSTALLER_BOOT_TRACE', ''\) === '1'/);
for (const phase of ['initial-render-sample', 'boot-timer-500ms-sample', 'resize-after-reflow-sample', 'resize-settled-sample']) {
  assert(installer.includes(phase), `Missing live welcome boot phase: ${phase}`);
}
for (const part of ['line-0', 'line-1', 'line-2', 'line-3', 'hero', 'panel', 'body-viewport', 'body-content', 'footer']) {
  assert(installer.includes(`'${part}'`), `Missing welcome native frame: ${part}`);
}
assert.match(installer, /UI\.getElementFrame/);
assert.match(installer, /Compositor\.getWindowInfo/);
assert.match(installer, /fractionalScale/);
assert.match(installer, /resizeSequence: sequence/);
assert.match(installer, /WELCOME_BOOT_RESIZE_EVENT/);
assert.doesNotMatch(installer, /Compositor\.resizeWindow/);

// Exercise the actual resize handler with two separate configure events, then
// a long drag. Framework modules are unavailable to Node, so only the handler
// is evaluated with its geometry and timer dependencies stubbed.
const handlerStart = installer.search(/  let (?:firstResizeTraced|resizeTraceCount) = /);
const handlerEnd = handlerStart + installer.slice(handlerStart).search(/\n  (?:await (?:buildChrome\(\)|serial\()|const initialRender = rendering\.then\()/);
assert(handlerStart >= 0 && handlerEnd > handlerStart, 'Welcome resize handler is present');
const handlers = new Map(), traces = [], timers = new Map(), eventLogs = [];
let timerId = 0;
let work = Promise.resolve();
let releaseGeometry;
const geometryGate = new Promise(resolve => { releaseGeometry = resolve; });
let holdGeometry = true, reflows = 0;
const context = {
  Event: { on: (name, handler) => handlers.set(name, handler) },
  win: 1, closed: false, page: 'welcome', bootTrace: true,
  wifi: null, secrets: {}, emptySecrets: () => ({}), Engine: { quit() {} },
  serial: job => (work = work.then(job)), picking: false, goBack() {}, close() {},
  traceBoot: async (phase, event, reflowed, sequence) => {
    traces.push({ phase, width: event?.width, reflowed, sequence });
    if (holdGeometry) await geometryGate;
  },
  Log: { info: message => eventLogs.push(message) },
  geometryFields: (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]])),
  canvasSize: async () => ({ x: 900, y: 740 }),
  size: { x: 960, y: 780 }, buildChrome: async () => { reflows++; }, render: async () => {}, view: {},
  setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
  clearTimeout: id => timers.delete(id)
};
vm.runInNewContext(installer.slice(handlerStart, handlerEnd), context);
const resize = handlers.get('windowResized');
assert(resize, 'Window resize handler is registered');
resize({ id: 1, width: 1290, height: 810 });
assert.equal(eventLogs.length, 1, 'Resize event is logged synchronously');
await new Promise(resolve => setImmediate(resolve));
assert.equal(reflows, 1, 'Native geometry sampling must not block resize reflow');
const firstEvent = JSON.parse(eventLogs[0].replace(/^WELCOME_BOOT_RESIZE_EVENT: /, ''));
assert.equal(firstEvent.resizeSequence, 1);
assert.equal(firstEvent.resizeEvent.width, 1290);
assert.equal(firstEvent.resizeEvent.height, 810);
assert.equal(firstEvent.canvas.x, 960, 'Event records canvas size before reflow');
assert.equal(firstEvent.canvas.y, 780, 'Event records canvas size before reflow');
assert.equal(typeof firstEvent.time, 'number');
holdGeometry = false;
releaseGeometry();
await work;
resize({ id: 1, width: 900, height: 740 });
await work;
assert(eventLogs.some(line => line.includes('"resizeSequence":2') && line.includes('"width":900')),
  'Second welcome resize must log its event and sequence');
assert(traces.some(trace => trace.phase === 'resize-after-reflow-sample' && trace.width === 900 && trace.sequence === 2),
  'Second welcome resize must log geometry after reflow');
for (let sequence = 3; sequence <= 12; sequence++) resize({ id: 1, width: 900 + sequence, height: 740 });
await work;
assert.equal(eventLogs.length, 12, 'Every welcome resize receives a synchronous event record');
assert.equal(traces.filter(trace => trace.phase === 'resize-after-reflow-sample').length, 8,
  'Only the first eight resizes receive full after-reflow geometry');
assert.equal(timers.size, 1, 'One trailing resize sample is pending');
for (const callback of timers.values()) callback();
await work;
assert(traces.some(trace => trace.phase === 'resize-settled-sample' && trace.width === 912 && trace.sequence === 12),
  'Trailing sample must include the final resize after a long drag');

// Run the registered startup path while its first native render is pending.
// A configure at that point must wait for startup's render to finish.
const startupEnd = installer.indexOf("\n  Log.info('Installer view ready');", handlerEnd);
assert(startupEnd > handlerEnd, 'Welcome startup sequence is present');
const serialStart = installer.indexOf('  const serial = job => ');
const serialSource = installer.slice(serialStart, installer.indexOf('\n', serialStart));
assert(serialStart >= 0 && serialSource.includes('rendering.then(job).catch('), 'Production serial contract is present');
const runStartup = context => vm.runInNewContext(`(async () => {
  let rendering = Promise.resolve(), error = '';
  const paintStatus = async () => {};
  ${serialSource}
  globalThis.installerQueue = () => rendering;
  ${installer.slice(handlerStart, startupEnd)}
})()`, context);
const startupHandlers = new Map(), bodies = [];
let releaseNative, nativeEntered;
const nativeGate = new Promise(resolve => { releaseNative = resolve; });
const enteredNative = new Promise(resolve => { nativeEntered = resolve; });
let activeRenders = 0, overlappingRenders = false, canvas = { x: 960, y: 780 };
let renderCalls = 0;
const startupContext = {
  Event: { on: (name, handler) => startupHandlers.set(name, handler) },
  win: 1, closed: false, page: 'welcome', bootTrace: false,
  wifi: null, secrets: {}, emptySecrets: () => ({}), Engine: { quit() {} },
  picking: false, goBack() {}, close() {},
  canvasSize: async () => canvas,
  size: { x: 960, y: 780 }, view: { shownPage: -1 },
  buildChrome: async () => { bodies.length = 0; },
  render: async () => {
    if (++activeRenders > 1) overlappingRenders = true;
    if (++renderCalls === 1) { nativeEntered(); await nativeGate; }
    bodies.push('installer-body');
    activeRenders--;
  },
  setTimeout: () => 1, clearTimeout() {}, Log: { info() {} }
};
const startup = runStartup(startupContext);
await enteredNative;
canvas = { x: 900, y: 740 };
startupHandlers.get('windowResized')({ id: 1, width: 900, height: 740 });
await new Promise(resolve => setImmediate(resolve));
const rendersBeforeRelease = renderCalls;
releaseNative();
await startup;
await startupContext.installerQueue();
assert.equal(rendersBeforeRelease, 1, 'Early resize waits while the initial native render is pending');
assert.equal(renderCalls, 2, 'Early resize reflows once after startup');
assert.equal(overlappingRenders, false, 'Early resize must not overlap initial native render');
assert.equal(bodies.length, 1, 'Early resize must leave one installer body');
for (const failedStep of ['buildChrome', 'render']) {
  const failure = new Error(`Initial ${failedStep} failed`);
  const failedContext = {
    ...startupContext,
    Event: { on() {} },
    buildChrome: async () => {}, render: async () => {},
    [failedStep]: async () => { throw failure; }
  };
  await assert.rejects(runStartup(failedContext), reason => reason === failure,
    `Initial ${failedStep} failure must reject the startup call`);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'koya-boot-trace-'));
try {
  const assets = path.join(temp, 'assets');
  fs.mkdirSync(path.join(assets, 'std'), { recursive: true });
  fs.writeFileSync(path.join(assets, 'std/koya-ui.js'), '');
  const binary = path.join(temp, 'fake-koya');
  fs.writeFileSync(binary, '#!/bin/sh\nprintf "%s\\n" "$KOYA_INSTALLER_PREVIEW" "$KOYA_INSTALLER_BOOT_TRACE" "$@"\n', { mode: 0o755 });
  const env = { ...process.env, KOYA_BIN: binary, KOYA_ASSET_DIR: assets, KOYA_INSTALLER_BOOT_TRACE: '1' };
  const live = spawnSync(root + '/run.sh', ['--verbose', 'ui,layout,wayland,vulkan'], { env, encoding: 'utf8' });
  assert.equal(live.status, 0, live.stderr);
  assert.match(live.stdout, /^0\n1\n[\s\S]*\n-i\ninstaller\.js\n--verbose\nui,layout,wayland,vulkan\n$/);
  const preview = spawnSync(root + '/run.sh', ['--preview'], { env: { ...env, KOYA_INSTALLER_BOOT_TRACE: '' }, encoding: 'utf8' });
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /^1\n\n/);
  assert.doesNotMatch(preview.stdout, /--verbose/);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('Live installer boot trace contract: passed');
