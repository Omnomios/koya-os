import * as Compositor from 'Koya/Compositor';
import * as Image from 'Koya/Image';
import * as Engine from 'Helix/Engine';
import * as Event from 'Helix/Event';
import * as Log from 'Helix/Log';
import * as Process from 'Module/process';
import * as UI from '/rom/apps/theme-ui.js';
import { text, label, icon, row, pill, toggle, throbber, button } from '/rom/apps/touch-ui.js';
import { textInput } from '/rom/apps/text-input.js';
import { passwordInput } from '/rom/apps/password-input.js';
import { createKit } from '/rom/apps/kit.js';
import { animator, presets } from '/rom/apps/motion.js';
import { withShadow } from '/rom/apps/shadow.js';
import { wallpaperCorner } from '/rom/apps/wallpapers.js';
import { surfaceCursor, destroySurface } from '/rom/apps/cursor.js';
import { wifiNetwork } from '/rom/apps/wifi-network.js';
import { TEXT, SURFACE, HEALTH, TYPE, SPACE, AUTO, CLEAR, ELEVATION, RADIUS, FONT, FONT_STRONG, configureTheme } from '/rom/apps/theme.js';
import { initialConfig, emptySecrets, accountError, passphraseError, installError, optionalApps, capacity, stages, searchZones, zoneCity, zoneRegion, offsetLabel, zoneTime } from './model.js';
import { backend, preview } from './backend.js';
import { mockWifi } from './mock.js';
import { installerTheme, INSTALLER_WALLPAPER } from './brand.js';

// The installer, in the desktop's own visual language: the wallpaper, dimmed,
// under a centred panel. A rail on the left marks the steps; the page fills
// the rest, over a footer whose main action lights up once the page is
// complete. Layout places everything; each part states its size.
//
// Pages: connect, disk, options, account, review, then installation and the
// finish. Choices are rows and switches, not text; the only words on a page
// are names, values and what went wrong.
const UI_SCALING = { referenceWidth: 1920, referenceHeight: 1080, mode: 'expand' };
// Both footer actions share one width (FOOTER_ACTION).
const PANEL = { x: 880, y: 600 }, RAIL = 196, PAD = 24, TITLE = 36, STATUS = 20, FOOTER = 36, ROW = 44, KEY = 132, ACTION = 132, FOOTER_ACTION = 172;
// Pages with a hero (a badge and title) above their body: it sits outside the
// scrolling body, which clips, so the badge's ring can swell past its slot.
const HERO = 52, HERO_PAGES = ['welcome', 'connect', 'complete'];
// The welcome page's hero is an inset holding the name and the koi. Its
// ripples spread past the slot, so it lives there rather than in the clipped
// body. The inset sits INSET_GAP from the panel edge.
const WELCOME_HERO = 260, INSET_GAP = 8, KOI = 104, KOI_Y = 166, NAME_Y = 30, GLOW = 236, RIPPLE = 124, RIPPLE_PERIOD = 4.2;
const heroHeight = page => page === 'welcome' ? WELCOME_HERO : HERO;
// Pages in order. Encryption (the disk passphrase) only appears when the disk
// is to be encrypted; see flow(). The rail shows every page but the finish.
const PAGES = ['welcome', 'connect', 'disk', 'options', 'encryption', 'account', 'review', 'install', 'complete'];
const STEPS = { connect: 'Connect', disk: 'Disk', options: 'Options', encryption: 'Encryption', account: 'Account', review: 'Review', install: 'Install' };
const TITLES = { welcome: '', connect: 'Get connected', disk: 'Choose a disk', options: 'Options', encryption: 'Disk encryption', account: 'Your account',
  review: 'Review', install: 'Installing', complete: 'Koya is installed' };
const MESSAGES = {
  preflight: 'Checking the installation', partition: 'Partitioning the disk', encrypt: 'Encrypting the root filesystem', format: 'Formatting and mounting the filesystems',
  packages: 'Installing Arch Linux and desktop packages', runtime: 'Installing Koya Shell', account: 'Creating your account',
  desktop: 'Configuring the desktop and greeter', wallpaper: 'Preparing the theme and wallpaper', services: 'Configuring services',
  boot: 'Installing the bootloader', finish: 'Syncing and releasing the disk'
};
const installerIcon = name => '/rom/assets/installer-icons/' + name + '.png';
const diskIcon = disk => installerIcon(disk.transport === 'usb' ? 'usb' : disk.transport === 'nvme' || /^\/dev\/nvme/.test(disk.path) ? 'nvme' : 'disk');
const bars = strength => Math.max(0, Math.min(3, Math.ceil(Number(strength) * 3 / 100)));
const signal = network => '/rom/assets/status/wifi-' + bars(network.Strength) + '.png';
const security = network => network.connected ? 'Connected' : !network.supported ? 'Needs advanced setup' : network.password ? 'Secured' : 'Open';

export async function installer() {
  const api = backend(), config = initialConfig(), secrets = emptySecrets();
  const bootTrace = !preview && Process.getEnv('KOYA_INSTALLER_BOOT_TRACE', '') === '1';
  let page = 'welcome', error = '', disks = [], online = false, installing = false, done = false, failed = false, showLog = false;
  let networks = { networks: [], loading: true }, chosen, wifiPassword = '', wifi, currentStage = '', log = '';
  // The timezone picker opens over the account page.
  let zones = [], picking = false, zoneQuery = '';
  let closed = false, rendering = Promise.resolve(), inputs = [], view = {};
  const displays = await Compositor.listDisplays({ backend: 'wayland' });
  if (!displays.length) throw new Error('No Wayland display');
  const display = displays[0];
  let size = { x: Math.min(960, Number(display.logical_width || display.width)), y: Math.min(780, Number(display.logical_height || display.height)) };
  const requestedSize = { ...size };
  const win = await Compositor.createWindow({ role: 'window', title: 'Koya Installer' + (preview ? ' — Preview' : ''), appId: 'koya-installer',
    size, msaaSamples: 4, acceptPointerEvents: true });
  // Use the engine's logical canvas for layout; it scales rendering and input.
  const canvasSize = async () => {
    const canvas = await Compositor.setUiScaling(win, UI_SCALING);
    return { x: Math.round(canvas.width), y: Math.round(canvas.height) };
  };
  size = await canvasSize();
  const kit = createKit(win), play = animator(win, 'Installer');
  const serial = job => (rendering = rendering.then(job).catch(reason => { error = reason?.message || String(reason); return paintStatus(); }));

  // Koya's installer palette and artwork (see brand.js).
  await configureTheme(installerTheme());
  await Compositor.setClearColor(win, ...SURFACE.background);
  const pondTexture = await Image.gradient(win, {
    ...INSTALLER_WALLPAPER.gradient, dst: '/ram/installer-pond-' + win, mipmaps: false
  });
  if (!pondTexture) throw new Error('Could not generate the installer pond gradient');

  // ---- Chrome: built once per window size ---------------------------------
  const panelSize = () => ({ x: Math.min(page === 'welcome' ? 760 : PANEL.x, size.x - SPACE.l * 2), y: Math.min(page === 'welcome' ? 500 : PANEL.y, size.y - SPACE.l * 2) });
  const railWidth = () => page === 'welcome' ? 0 : RAIL;
  const mainWidth = () => panelSize().x - railWidth() - PAD * 2;
  const heroWidth = () => page === 'welcome' ? panelSize().x - INSET_GAP * 2 : mainWidth();
  // The welcome page has no title or status line: its hero leads, and nothing on it can fail.
  const bodyHeight = () => panelSize().y - PAD - (page === 'welcome' ? INSET_GAP : PAD + TITLE + SPACE.m + STATUS + SPACE.m) - FOOTER - SPACE.m
    - (HERO_PAGES.includes(page) ? heroHeight(page) + SPACE.m : 0);
  let root;
  const buildChrome = async () => {
    for (const input of inputs) await input.destroy();
    inputs = [];
    if (root) { await UI.destroyElement(win, root); body = undefined; }
    const panel = panelSize();
    root = await UI.createElement(win, { renderable: { type: 'box', colour: SURFACE.background }, layout: { type: 'none' }, item: { size: AUTO },
      contentAlign: 'fill', onHover: surfaceCursor(win) });
    // Stretch the smooth radial wash; anchor the detailed artwork separately.
    const art = INSTALLER_WALLPAPER;
    const [wall, centre] = await Promise.all([UI.createElement(win, { renderable: { type: 'sprite', texture: pondTexture, frame: 0,
      frames: [{ size, origin: { x: 0, y: 0 }, aabb: { min: { x: 0, y: 0 }, max: art.gradient.size }, colour: [1, 1, 1, 1] }] },
      layout: { type: 'none' }, item: { size: { ...size }, order: -1 }, contentAlign: 'fill' }),
      UI.createElement(win, { layout: { type: 'row', justifyContent: 'center', alignItems: 'center' }, item: { size: AUTO } })]);
    await UI.setHitTarget(win, wall, false);
    for (const corner of art.corners) {
      const { position, size: extent, frame } = wallpaperCorner(corner, size);
      const element = await UI.createElement(win, {
        renderable: { type: 'sprite', texture: corner.texture, frame: 0, frames: [frame] },
        item: { position, size: extent }, contentAlign: 'fill'
      });
      await UI.setHitTarget(win, element, false);
      await UI.attach(win, wall, element);
    }
    const column = await UI.createElement(win, { layout: { type: 'column', justifyContent: 'center' }, item: { size: { x: panel.x + 80, y: 'auto' } } });
    const surface = await kit.surface('panel', { id: 'installer-panel', size: panel, layout: { type: 'row' } });
    const [rail, main] = await Promise.all([
      kit.surface('inset', { size: { x: RAIL, y: 'auto' }, layout: { type: 'column', gap: SPACE.s }, padding: { t: PAD, r: SPACE.l, b: PAD, l: SPACE.l } }),
      // On the welcome page the hero runs nearly to the panel edge; the rest keeps its padding.
      UI.createElement(win, { layout: { type: 'column', gap: SPACE.m, ...(page === 'welcome'
        ? { padding: { t: INSET_GAP, r: INSET_GAP, b: PAD, l: INSET_GAP } } : { padding: { t: PAD, r: PAD, b: PAD, l: PAD } }) },
        item: { size: { x: panel.x - railWidth(), y: 'auto' } } })
    ]);
    // The rail: the mark, then one line per step.
    const brand = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.s, alignItems: 'center' }, item: { size: { x: 'auto', y: 32 }, margin: { t: 0, r: 0, b: SPACE.l, l: 0 } } });
    await icon(win, brand, '/rom/assets/brand/koya-fish.png', 24, 28, 32);
    await text(win, brand, 'Koya', TYPE.heading, 100, 32, TEXT.primary, FONT_STRONG, 'left');
    await UI.attach(win, rail.content, brand);
    const steps = [];
    for (const [id, name] of Object.entries(STEPS)) {
      const line = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.s, alignItems: 'center' }, item: { size: { x: 'auto', y: 28 } } });
      // A dot over a halo; the halo shows only behind the current step.
      const holder = await UI.createElement(win, { layout: { type: 'none' }, item: { size: { x: 20, y: 20 } } });
      const halo = await UI.createElement(win, { renderable: { type: 'circle', aabb: { min: { x: 0, y: 0 }, max: { x: 20, y: 20 } }, resolution: 32, colour: SURFACE.avatar, origin: { x: 0.5, y: 0.5 } },
        item: { size: AUTO }, contentAlign: 'fill' });
      const dot = await UI.createElement(win, { renderable: { type: 'circle', aabb: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } }, resolution: 24, colour: SURFACE.track, origin: { x: 0.5, y: 0.5 } },
        item: { size: AUTO, margin: { t: 5, r: 5, b: 5, l: 5 } }, contentAlign: 'fill' });
      await Promise.all([UI.attach(win, holder, halo), UI.attach(win, holder, dot), UI.attach(win, line, holder), UI.setEnabled(win, halo, false)]);
      const label = await text(win, line, name, TYPE.detail, RAIL - SPACE.l * 2 - 28, 28, TEXT.secondary, FONT, 'left');
      await UI.attach(win, rail.content, line);
      steps.push({ id, line, dot, halo, label });
    }
    // The main column: title, body, status, footer.
    const [title, heroHost, bodyHost, status, footer] = await Promise.all([
      text(win, null, '', TYPE.title, mainWidth(), TITLE, TEXT.primary, FONT_STRONG, page === 'welcome' ? 'center' : 'left'),
      UI.createElement(win, { layout: { type: 'none' }, item: { size: { x: heroWidth(), y: heroHeight(page) } } }),
      UI.createElement(win, { layout: { type: 'column' }, item: { size: { x: mainWidth(), y: bodyHeight() } } }),
      text(win, null, '', TYPE.caption, mainWidth(), STATUS, TEXT.accent, FONT, 'left'),
      UI.createElement(win, { layout: { type: 'row', justifyContent: 'space-between', alignItems: 'center' }, item: { size: { x: mainWidth(), y: FOOTER } } })
    ]);
    for (const [index, id] of [title, heroHost, bodyHost, status, footer].entries()) { await UI.setLayoutOrder(win, id, index); await UI.attach(win, main, id); }
    // Under the welcome hero, the page keeps its usual inset from the panel edge.
    if (page === 'welcome') for (const id of [bodyHost, status, footer]) await UI.setMargin(win, id, { t: 0, r: PAD - INSET_GAP, b: 0, l: PAD - INSET_GAP });
    let backLabel, nextLabel, nextFeedback;
    const back = await pill(win, null, 'Back', FOOTER_ACTION, () => serial(goBack), { height: FOOTER, onLabel: id => { backLabel = id; } });
    const next = await pill(win, null, page === 'welcome' ? 'Install' : 'Continue', FOOTER_ACTION, () => serial(goNext), {
      height: FOOTER, onLabel: id => { nextLabel = id; },
      ...(page === 'welcome' ? { leadingIcon: installerIcon('install') } : { onFeedback: value => { nextFeedback = value; } })
    });
    await Promise.all([UI.attach(win, footer, back), UI.attach(win, footer, next), UI.setElementId(win, back, 'installer-back'), UI.setElementId(win, next, 'installer-next'),
      UI.setElementId(win, status, 'installer-status'), UI.setElementId(win, title, 'installer-title')]);
    await Promise.all([UI.attach(win, surface.content, rail.id), UI.attach(win, surface.content, main)]);
    await Promise.all([UI.setEnabled(win, rail.id, page !== 'welcome'), UI.setEnabled(win, title, page !== 'welcome'), UI.setEnabled(win, status, page !== 'welcome')]);
    const shaded = await withShadow(win, surface.id, panel, ELEVATION.panel.shadow);
    await UI.attach(win, column, shaded); await UI.attach(win, centre, column);
    await UI.attach(win, root, wall); await UI.attach(win, root, centre);
    await UI.attachRoot(win, root);
    play(shaded, presets.rise(0, 0.05));
    view = { title, heroHost, bodyHost, status, footer, panel: surface.id, back, next, backLabel, nextLabel, nextFeedback, steps,
      welcome: page === 'welcome', shownPage: -1, ready: undefined, welcomeLines: [] };
  };

  // ---- Shared page parts ---------------------------------------------------
  let body, bodyFill = 0, items = [];
  const add = async (id, height) => { await UI.attach(win, body.content, id); bodyFill += height + SPACE.s; items.push(id); return id; };
  const header = async (caption, action) => { const built = await kit.sectionHeader({ caption, action }); await add(built.id, built.height); return built; };
  const card = async (rows, rowHeight = ROW) => {
    const height = rows * rowHeight + SPACE.s * 2;
    const surface = await kit.surface('inset', { size: { x: mainWidth(), y: height }, layout: { type: 'column' }, padding: { t: SPACE.s, r: SPACE.m, b: SPACE.s, l: SPACE.m } });
    await add(surface.id, height);
    return surface.content;
  };
  const inner = () => mainWidth() - SPACE.m * 2;
  // One centred line across the body. (Text justify sets the origin, not where
  // lines sit in the element, so a centred paragraph is set line by line.)
  let glowTexture, rippleTexture, insetTexture;
  const centred = (value, size, height, colour, font = FONT) => text(win, null, value, size, mainWidth(), height, colour, font, 'center');
  // The hero row, in its own unclipped slot above the body.
  const placeHero = async () => {
    view.hero = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.m, alignItems: 'center' }, item: { size: AUTO } });
    await UI.attach(win, view.heroHost, view.hero);
    return view.hero;
  };
  // A labelled row in a card: the key, then a control.
  const keyed = async (parent, key, control) => {
    const line = await UI.createElement(win, { layout: { type: 'row', alignItems: 'center', gap: SPACE.s }, item: { size: { x: 'auto', y: ROW } } });
    const label = await text(win, line, key, TYPE.caption, KEY, ROW, TEXT.secondary, FONT, 'left');
    await Promise.all([UI.setLayoutOrder(win, label, 0), UI.setLayoutOrder(win, control, 1), UI.attach(win, line, control)]);
    await UI.attach(win, parent, line);
  };
  const field = async (parent, key, value, change, { password = false, placeholder = '', id, submit } = {}) => {
    const make = password ? passwordInput : textInput;
    // Fields sit on inset cards: the field role, not the default inset fill
    // (the card's own colour), keeps them visible.
    const input = await make(win, { width: inner() - KEY - SPACE.s, height: 34, size: TYPE.body, value, placeholder, maxLength: password ? 512 : 128, colour: SURFACE.field,
      ...(id ? { id } : {}), ...(submit ? { onSubmit: submit } : {}), onInput: next => { change(next); refreshFooter(); } });
    inputs.push(input);
    await keyed(parent, key, input.master.id);
    return input;
  };
  // Title over a quiet line, for rows and switches. The column is as tall as
  // its row (ROW + 8): cross-axis alignment only centres within the line,
  // which starts at the row's top, so a shorter column would sit high.
  const lines = async (parent, title, detail, width, colours = [TEXT.primary, TEXT.secondary]) => {
    const column = await UI.createElement(win, { layout: { type: 'column', justifyContent: 'center' }, item: { size: { x: width, y: ROW + 8 } } });
    const [heading, caption] = [await text(win, column, title, TYPE.body, width, 20, colours[0], FONT, 'left'),
      await text(win, column, detail, TYPE.caption, width, 18, colours[1], FONT, 'left')];
    await UI.attach(win, parent, column);
    return { column, heading, caption };
  };
  // A switch row in a card.
  const option = async (parent, title, detail, on, change, id, glyph) => {
    const line = await UI.createElement(win, { layout: { type: 'row', alignItems: 'center', gap: SPACE.s }, item: { size: { x: 'auto', y: ROW + 8 } } });
    if (glyph) await icon(win, line, installerIcon(glyph), 28, 32, ROW + 8);
    const words = await lines(line, title, detail, inner() - 56 - SPACE.s - (glyph ? 32 + SPACE.s : 0));
    const control = await toggle(win, null, on, () => { const value = change(); control.set(value); refreshFooter(); });
    await Promise.all([UI.setLayoutOrder(win, words.column, 1), UI.setLayoutOrder(win, control.id, 2), UI.attach(win, line, control.id), UI.setElementId(win, control.id, id)]);
    await UI.attach(win, parent, line);
    return control;
  };

  // ---- Pages ---------------------------------------------------------------
  const flow = () => PAGES.filter(id => id !== 'encryption' || config.encrypt);
  const pages = {
    welcome: async () => {
      // A darker inset with the name above the koi. Behind the koi: a radial
      // light, a glow, three staggered ripples and a slow vertical drift. The
      // description sits below the inset.
      const width = heroWidth(), centre = { x: width / 2, y: KOI_Y };
      const at = extent => ({ position: { x: centre.x - extent / 2, y: centre.y - extent / 2 }, size: { x: extent, y: extent } });
      glowTexture ||= await Image.gradient(win, { type: 'radial', size: { x: 256, y: 256 }, radial: { center: { x: 0.5, y: 0.5 }, radius: 0.5 },
        stops: [{ at: 0, colour: [...SURFACE.accent.slice(0, 3), 0.55] }, { at: 0.45, colour: [...SURFACE.accent.slice(0, 3), 0.26] }, { at: 1, colour: [...SURFACE.accent.slice(0, 3), 0] }],
        dst: '/ram/installer-glow-' + win, mipmaps: false });
      // A ripple is a soft ring: transparent inside and out, peaking near the edge.
      rippleTexture ||= await Image.gradient(win, { type: 'radial', size: { x: 256, y: 256 }, radial: { center: { x: 0.5, y: 0.5 }, radius: 0.5 },
        stops: [{ at: 0, colour: [...SURFACE.accent.slice(0, 3), 0] }, { at: 0.58, colour: [...SURFACE.accent.slice(0, 3), 0] },
          { at: 0.8, colour: [...SURFACE.accent.slice(0, 3), 0.46] }, { at: 0.89, colour: [...SURFACE.accent.slice(0, 3), 0.15] }, { at: 1, colour: [...SURFACE.accent.slice(0, 3), 0] }],
        dst: '/ram/installer-ripple-' + win, mipmaps: false });
      // Darker than the panel at the edges, with faint teal light behind the koi.
      insetTexture ||= await Image.gradient(win, { type: 'radial', size: { x: 512, y: 512 }, radial: { center: { x: 0.5, y: 0.5 }, radius: 0.5 },
        stops: [{ at: 0, colour: [15 / 255, 27 / 255, 31 / 255, 1] }, { at: 0.6, colour: [10 / 255, 15 / 255, 18 / 255, 1] }, { at: 1, colour: [8 / 255, 11 / 255, 14 / 255, 1] }],
        dst: '/ram/installer-inset-' + win, mipmaps: false });
      const stage = await UI.createElement(win, { renderable: { type: 'box', colour: insetTexture ? [1, 1, 1, 1] : [5 / 255, 8 / 255, 10 / 255, 1],
        ...(insetTexture ? { texture: insetTexture } : {}), cornerRadius: RADIUS.surface, cornerResolution: 16 },
        layout: { type: 'none' }, item: { size: AUTO }, contentAlign: 'fill', clipToBounds: true });
      view.hero = stage;
      const name = await text(win, null, 'Koya Shell', 32, width, 40, TEXT.primary, FONT_STRONG, 'center');
      await UI.setLayoutPosition(win, name, { x: 0, y: NAME_Y });
      const glow = glowTexture ? await UI.createElement(win, { renderable: { type: 'sprite', texture: glowTexture, frame: 0, origin: { x: 0.5, y: 0.5 },
        frames: [{ size: { x: GLOW, y: GLOW }, origin: { x: 0, y: 0 }, aabb: { min: { x: 0, y: 0 }, max: { x: 256, y: 256 } }, colour: [1, 1, 1, 1] }] },
        item: at(GLOW), contentAlign: 'fill' }) : undefined;
      const ripples = [];
      if (rippleTexture) for (let index = 0; index < 3; index++) ripples.push(await UI.createElement(win, { renderable: { type: 'sprite', texture: rippleTexture, frame: 0,
        origin: { x: 0.5, y: 0.5 }, frames: [{ size: { x: RIPPLE, y: RIPPLE }, origin: { x: 0, y: 0 }, aabb: { min: { x: 0, y: 0 }, max: { x: 256, y: 256 } }, colour: [1, 1, 1, 1] }] },
        item: at(RIPPLE), contentAlign: 'fill' }));
      const koi = await icon(win, null, '/rom/assets/brand/koya-fish.png', KOI - 16, KOI, KOI);
      await UI.setLayoutPosition(win, koi, at(KOI).position);
      for (const id of [glow, ...ripples, koi, name].filter(Boolean)) { await UI.setHitTarget(win, id, false); await UI.attach(win, stage, id); }
      await UI.attach(win, view.heroHost, stage);
      const live = () => view.hero === stage && !closed;
      const later = (seconds, job) => setTimeout(() => { if (live()) job(); }, seconds * 1000);
      ripples.forEach(id => play(id, [{ time: 0, opacity: 0 }]));
      if (glow) {
        play(glow, [{ time: 0, opacity: 0, scale: { x: 0.5, y: 0.5 } }, { time: 0.15, opacity: 0, scale: { x: 0.5, y: 0.5 } },
          { time: 0.9, opacity: 1, scale: { x: 1, y: 1 }, ease: 'outCubic' }]);
        later(0.9, () => play(glow, [{ time: 0, opacity: 1, scale: { x: 1, y: 1 } }, { time: 2.4, opacity: 0.7, scale: { x: 1.08, y: 1.08 }, ease: 'inOutQuad' },
          { time: 4.8, opacity: 1, scale: { x: 1, y: 1 }, ease: 'inOutQuad', looping: true }]));
      }
      play(koi, [{ time: 0, opacity: 0, scale: { x: 0.6, y: 0.6 } }, { time: 0.15, opacity: 0, scale: { x: 0.6, y: 0.6 } },
        { time: 0.55, opacity: 1, scale: { x: 1.06, y: 1.06 }, ease: 'outCubic' }, { time: 0.8, scale: { x: 1, y: 1 }, ease: 'inOutQuad' }]);
      later(0.8, () => play(koi, [{ time: 0, position: { x: 0, y: 0 } }, { time: 1.8, position: { x: 0, y: -5 }, ease: 'inOutQuad' },
        { time: 3.6, position: { x: 0, y: 0 }, ease: 'inOutQuad', looping: true }]));
      // Each ripple fades in, grows and fades out; three are staggered across one period.
      ripples.forEach((id, index) => later(0.5 + index * RIPPLE_PERIOD / 3, () => play(id, [{ time: 0, opacity: 0, scale: { x: 0.8, y: 0.8 } },
        { time: 0.9, opacity: 1, scale: { x: 1.2, y: 1.2 }, ease: 'inOutQuad' }, { time: RIPPLE_PERIOD, opacity: 0, scale: { x: 2.3, y: 2.3 }, ease: 'outQuad', looping: true }])));
      play(name, presets.rise(0, 0.1));
      later(1.1, () => play(view.next, presets.bump()));
      // The copy sits centred between the inset and the buttons.
      const copyHeight = 24 + 3 * 18 + 3 * SPACE.s;
      const lead = Math.max(0, Math.round((bodyHeight() - copyHeight) / 2 - SPACE.s));
      await add(await UI.createElement(win, { item: { size: { x: mainWidth(), y: lead } } }), lead);
      const welcomeLine = async (value, size, height, colour) => {
        const id = await centred(value, size, height, colour);
        if (bootTrace) view.welcomeLines.push(id);
        return id;
      };
      await add(await welcomeLine('A desktop shell built on Koya, for Hyprland and Arch.', TYPE.heading, 24, TEXT.primary), 24);
      for (const line of ['One shell from the login screen to the lock screen, with one theme across all of it.',
        'The visual polish of a web stack without the cruft. There’s no browser underneath;',
        'Koya draws it on the GPU in around 48 MB of memory.'])
        await add(await welcomeLine(line, TYPE.body, 18, TEXT.secondary), 18 - SPACE.s);
    },
    // Connect: the connection, then Wi-Fi networks; a chosen secured one asks for its password in place.
    connect: async () => {
      const hero = await placeHero();
      const badge = await kit.badge({ glyph: '/rom/assets/status/wifi-off.png', health: 'warn' });
      const title = await kit.titleBlock({ title: 'Offline', subtitle: 'Join a network to continue', dot: 'warn' });
      await UI.attach(win, hero, badge.id); await UI.attach(win, hero, title.id);
      badge.pop();
      const head = await header('Wi-Fi', { label: 'Scan', id: 'installer-scan', onActivate: () => wifi?.scan().catch(reason => {
        error = reason?.message || String(reason); serial(paintStatus);
      }) });
      const list = await UI.createElement(win, { layout: { type: 'column', gap: SPACE.s }, item: { size: { x: mainWidth(), y: 0 } } });
      await add(list, 0);
      view.connect = { badge, title, head, list, rows: new Map(), height: 0 };
      await reconcileConnect();
    },
    // Disk: every disk; those that cannot be used say why and do not respond.
    disk: async () => {
      await header('Disks', { label: 'Refresh', id: 'installer-refresh', onActivate: () => serial(async () => { disks = await api.disks(); await render(); }) });
      for (const disk of disks) {
        const selected = config.disk === disk.path, usable = !disk.reason;
        const target = await row(win, null, mainWidth(), ROW + 8, () => serial(async () => {
          if (!usable) { error = disk.reason; await paintStatus(); play(view.status, presets.shake()); return; }
          config.disk = disk.path; config.diskKey = disk.key; await render();
        }), { colour: selected ? SURFACE.selected : SURFACE.card, cursor: usable ? 'pointer' : 'default', ...(usable ? {} : { hover: SURFACE.card }) });
        await icon(win, target, diskIcon(disk), 32, 40, ROW + 8);
        await lines(target, disk.model, usable ? capacity(disk.size) + ' · ' + disk.path : disk.reason + ' · ' + disk.path,
          mainWidth() - 12 - 8 - 40 - 24 - 24, usable ? [TEXT.primary, TEXT.secondary] : [TEXT.disabled, TEXT.disabled]);
        const mark = await UI.createElement(win, { renderable: { type: 'circle', aabb: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } }, resolution: 24,
          colour: selected ? SURFACE.accent : CLEAR, origin: { x: 0.5, y: 0.5 } }, item: { size: { x: 10, y: 10 }, margin: { t: 0, r: 7, b: 0, l: 7 } } });
        await UI.attach(win, target, mark);
        await UI.setElementId(win, target, 'installer-disk-' + disk.path.split('/').pop());
        await add(target, ROW + 8);
        if (selected && view.justChose === disk.path) { play(mark, presets.pop(0, 0.4)); view.justChose = ''; }
      }
      if (!disks.length) { const empty = await kit.emptyState({ glyph: installerIcon('disk'), message: 'No disks', width: mainWidth(), height: 96 }); await add(empty.id, 96); }
    },
    // Options: encryption and the optional applications, as switches.
    options: async () => {
      await header('Security');
      let host = await card(1, ROW + 8);
      await option(host, 'Encrypt the disk', 'A passphrase at every start', config.encrypt,
        () => { config.encrypt = !config.encrypt; secrets.luks = secrets.luksAgain = ''; return config.encrypt; }, 'installer-encrypt', 'encryption');
      await header('Applications');
      host = await card(optionalApps.length, ROW + 8);
      for (const app of optionalApps) await option(host, app.name, app.description, config.apps.includes(app.id), () => {
        config.apps = config.apps.includes(app.id) ? config.apps.filter(id => id !== app.id) : [...config.apps, app.id];
        return config.apps.includes(app.id);
      }, 'installer-app-' + app.id, app.id);
    },
    // Encryption: the passphrase asked for at every start, twice.
    encryption: async () => {
      const introduction = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.m, alignItems: 'center' }, item: { size: { x: mainWidth(), y: 112 } } });
      await icon(win, introduction, installerIcon('encrypted-disk'), 104, 112, 112);
      const words = await UI.createElement(win, { layout: { type: 'column', justifyContent: 'center', gap: SPACE.s }, item: { size: { x: mainWidth() - 112 - SPACE.m, y: 112 } } });
      await text(win, words, 'Unlock at startup', TYPE.heading, mainWidth() - 112 - SPACE.m, 28, TEXT.primary, FONT_STRONG, 'left');
      await text(win, words, 'Use this passphrase each time you start your computer.', TYPE.body, mainWidth() - 112 - SPACE.m, 48, TEXT.secondary, FONT, 'left');
      await UI.attach(win, introduction, words);
      await add(introduction, 112);
      await header('Passphrase');
      const host = await card(2);
      const first = await field(host, 'Passphrase', secrets.luks, value => { secrets.luks = value; }, { password: true, id: 'installer-luks', submit: () => serial(goNext) });
      await field(host, 'Confirm', secrets.luksAgain, value => { secrets.luksAgain = value; }, { password: true, id: 'installer-luks-again', submit: () => serial(goNext) });
      await first.focus();
    },
    // Account: who and where, then the account password.
    account: async () => {
      const introduction = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.m, alignItems: 'center' }, item: { size: { x: mainWidth(), y: 80 } } });
      await icon(win, introduction, installerIcon('user-account'), 80, 88, 80);
      const words = await UI.createElement(win, { layout: { type: 'column', justifyContent: 'center', gap: SPACE.s }, item: { size: { x: mainWidth() - 88 - SPACE.m, y: 80 } } });
      await text(win, words, 'Make it yours', TYPE.heading, mainWidth() - 88 - SPACE.m, 28, TEXT.primary, FONT_STRONG, 'left');
      await text(win, words, 'Create the account you’ll use to sign in.', TYPE.body, mainWidth() - 88 - SPACE.m, 36, TEXT.secondary, FONT, 'left');
      await UI.attach(win, introduction, words);
      await add(introduction, 80);
      let host = await card(3);
      await field(host, 'Account name', config.username, value => { config.username = value; }, { id: 'installer-username' });
      await field(host, 'Computer name', config.hostname, value => { config.hostname = value; }, { id: 'installer-hostname' });
      // The timezone is chosen from a list, never typed: a button showing
      // the city, the time there and its offset.
      const zone = zones.find(item => item.zone === config.timezone);
      const width = inner() - KEY - SPACE.s;
      const picker = await button(win, null, '', width, 34, () => serial(openPicker), { colour: SURFACE.field, hover: SURFACE.controlHover,
        element: { layout: { type: 'row', alignItems: 'center', gap: SPACE.s, padding: { l: 12, r: 8, t: 0, b: 0 } } } });
      await text(win, picker, zoneCity(config.timezone), TYPE.body, width - 12 - 8 - 130 - 14 - SPACE.s * 2, 34, TEXT.primary, FONT, 'left');
      await text(win, picker, zone ? zoneTime(zone.offset) + ' · ' + offsetLabel(zone.offset) : '', TYPE.caption, 130, 34, TEXT.secondary, FONT, 'right');
      await icon(win, picker, '/rom/assets/launcher/next.png', 12, 14, 34);
      await keyed(host, 'Timezone', picker);
      await UI.setElementId(win, picker, 'installer-timezone');
      if (view.justPicked) { play(picker, presets.bump()); view.justPicked = false; }
      await header('Password');
      host = await card(2);
      await field(host, 'Password', secrets.password, value => { secrets.password = value; }, { password: true, id: 'installer-password' });
      await field(host, 'Confirm', secrets.passwordAgain, value => { secrets.passwordAgain = value; }, { password: true, id: 'installer-password-again' });
    },
    // Review: what will happen, including what is erased. Erase and install
    // is the confirmation.
    review: async () => {
      const selected = disks.find(disk => disk.path === config.disk);
      const apps = optionalApps.filter(app => config.apps.includes(app.id)).map(app => app.name);
      const facts = await kit.keyValue([
        { key: 'Disk', value: (selected?.model || 'Disk') + ' · ' + capacity(selected?.size) },
        { key: 'Layout', value: '512 MiB EFI · ' + (config.encrypt ? 'encrypted ext4' : 'ext4') },
        { key: 'Account', value: config.username + ' on ' + config.hostname },
        { key: 'Timezone', value: config.timezone },
        { key: 'Applications', value: apps.join(', ') || 'None' }
      ], { keyWidth: 104 });
      await add(facts.id, facts.height); view.dispose = () => facts.dispose();
      const warning = await kit.surface('inset', { size: { x: mainWidth(), y: ROW + SPACE.s * 2 }, layout: { type: 'column' }, padding: { t: SPACE.s, r: SPACE.m, b: SPACE.s, l: SPACE.m } });
      await add(warning.id, ROW + SPACE.s * 2);
      await text(win, warning.content, 'Everything on ' + config.disk + ' will be erased', TYPE.body, inner(), ROW, TEXT.accent, FONT_STRONG, 'left');
    },
    // Installing: progress, the stages, and the command output on request.
    install: async () => {
      const plan = stages.filter(stage => stage !== 'encrypt' || config.encrypt);
      const meter = await kit.meter({ label: 'Progress', width: mainWidth(), segments: plan.length });
      await add(meter.id, meter.height);
      const host = await card(plan.length, 28);
      const rows = [];
      for (const stage of plan) {
        const line = await UI.createElement(win, { layout: { type: 'row', alignItems: 'center', gap: SPACE.s }, item: { size: { x: 'auto', y: 28 } } });
        const holder = await UI.createElement(win, { layout: { type: 'none' }, item: { size: { x: 16, y: 28 } } });
        const dot = await UI.createElement(win, { renderable: { type: 'circle', aabb: { min: { x: 0, y: 0 }, max: { x: 8, y: 8 } }, resolution: 16, colour: SURFACE.track, origin: { x: 0.5, y: 0.5 } },
          item: { size: { x: 8, y: 8 }, margin: { t: 10, r: 4, b: 10, l: 4 } }, contentAlign: 'fill' });
        const spinner = await throbber(win, null, 14, TEXT.accent, 28);
        await Promise.all([UI.attach(win, holder, dot), UI.attach(win, holder, spinner.id), UI.attach(win, line, holder)]);
        const label = await text(win, line, MESSAGES[stage] || stage, TYPE.detail, inner() - 16 - SPACE.s, 28, TEXT.disabled, FONT, 'left');
        await UI.attach(win, host, line);
        rows.push({ stage, dot, spinner, label, state: 'pending' });
      }
      const output = await header('Output', { label: showLog ? 'Hide' : 'Show', id: 'installer-output', onActivate: () => serial(async () => { showLog = !showLog; await render(); }) });
      if (showLog) {
        const logHost = await card(1, 160);
        view.logText = await text(win, logHost, log.slice(-1600), TYPE.caption, inner(), 160, TEXT.secondary, FONT, 'left');
      } else view.logText = undefined;
      view.install = { meter, rows, output };
      await paintInstall(false);
    },
    // Finished.
    complete: async () => {
      const hero = await placeHero();
      const badge = await kit.badge({ glyph: '/rom/assets/brand/koya-fish.png', health: 'good' });
      const title = await kit.titleBlock({ title: preview ? 'Preview complete' : 'Ready to start', subtitle: preview ? 'No disks were changed' : 'Remove the USB after shutting down' });
      await UI.attach(win, hero, badge.id); await UI.attach(win, hero, title.id);
      badge.pop(); badge.pulse(false);
      const selected = disks.find(disk => disk.path === config.disk);
      const facts = await kit.keyValue([
        { key: 'Disk', value: (selected?.model || config.disk) + (config.encrypt ? ' · encrypted' : '') },
        { key: 'Account', value: config.username + ' on ' + config.hostname },
        { key: 'Applications', value: optionalApps.filter(app => config.apps.includes(app.id)).map(app => app.name).join(', ') || 'None' }
      ], { keyWidth: 104 });
      await add(facts.id, facts.height); view.dispose = () => facts.dispose();
    }
  };

  // The connect page owns its native elements until navigation or resize.
  // NetworkManager publishes frequently, including unchanged lists during a scan.
  const reconcileConnect = async () => {
    const connect = view.connect;
    if (closed || page !== 'connect' || !connect) return;
    const published = networks.networks || [], wired = networks.available === false && !networks.loading;
    const scanning = !!(wifi?.state?.scanning || networks.loading);
    // A scan can briefly omit APs before its final publication. Keep their
    // existing rows and selection until the scan finishes or the device goes.
    const publishedKeys = new Set(published.map(network => network.key));
    const list = scanning && !wired
      ? published.concat([...connect.rows].filter(([key]) => !publishedKeys.has(key)).map(([, entry]) => entry.network))
      : published;
    const connected = list.find(network => network.connected);
    const glyph = connected ? signal(connected) : '/rom/assets/status/' + (online ? 'ethernet' : 'wifi-off') + '.png';
    const heading = online ? 'Online' : 'Offline';
    const subtitle = online ? (connected ? connected.name : 'Wired connection') : wired ? 'No Wi-Fi device' : 'Join a network to continue';
    const jobs = [];
    if (connect.glyph !== glyph) { connect.glyph = glyph; jobs.push(connect.badge.setGlyph(glyph)); }
    if (connect.heading !== heading) { connect.heading = heading; jobs.push(UI.setTextString(win, connect.title.heading, heading)); }
    if (connect.subtitle !== subtitle) { connect.subtitle = subtitle; jobs.push(UI.setTextString(win, connect.title.caption, subtitle)); }
    if (connect.online !== online) {
      connect.online = online;
      jobs.push(connect.title.setDot(online ? 'good' : 'warn'));
    }
    if (connect.scanning !== scanning) { connect.scanning = scanning; jobs.push(connect.head.setBusy(scanning)); }
    if (connect.wired !== wired) {
      connect.wired = wired;
      jobs.push(UI.setEnabled(win, connect.head.id, !wired));
      jobs.push(UI.setLayoutSize(win, connect.head.id, { x: 'auto', y: wired ? 0 : connect.head.height }));
    }
    if (connect.working !== !!wifi?.state?.working) {
      connect.working = !!wifi?.state?.working;
      connect.badge.pulse(connect.working);
    }
    if (connect.networkError !== networks.error) {
      if (error === connect.networkError || networks.error) error = networks.error || '';
      connect.networkError = networks.error;
    }
    if (connect.error !== error) { connect.error = error; jobs.push(paintStatus()); }
    await Promise.all(jobs);

    if (chosen) chosen = list.find(network => network.key === chosen.key);
    if (!chosen && connect.selection) { wifiPassword = ''; await removeSelection(connect); }

    // The power control is created once. Its height participates in the list
    // only while the device is off.
    if (!wired && networks.enabled === false && !connect.power) {
      const surface = await kit.surface('inset', { size: { x: mainWidth(), y: ROW + 8 + SPACE.s * 2 },
        layout: { type: 'column' }, padding: { t: SPACE.s, r: SPACE.m, b: SPACE.s, l: SPACE.m } });
      const line = await UI.createElement(win, { layout: { type: 'row', alignItems: 'center', gap: SPACE.s }, item: { size: { x: 'auto', y: ROW + 8 } } });
      const words = await lines(line, 'Wi-Fi', networks.hardware === false ? 'Blocked by the device' : 'Off', inner() - 56 - SPACE.s);
      const control = await toggle(win, null, false, () => serial(() => wifi?.toggle()));
      await Promise.all([UI.attach(win, line, control.id), UI.attach(win, surface.content, line), UI.setElementId(win, control.id, 'installer-wifi-power')]);
      await UI.attach(win, connect.list, surface.id);
      connect.power = { id: surface.id, control, detail: words.caption, hardware: networks.hardware };
    }
    if (connect.power && (wired || networks.enabled !== false)) {
      await UI.destroyElement(win, connect.power.id);
      connect.power = undefined;
    }
    if (connect.power) {
      const powerJobs = [];
      if (connect.power.hardware !== networks.hardware) {
        connect.power.hardware = networks.hardware;
        powerJobs.push(UI.setTextString(win, connect.power.detail, networks.hardware === false ? 'Blocked by the device' : 'Off'));
      }
      await Promise.all(powerJobs);
    }

    const incoming = new Set(list.map(network => network.key));
    await Promise.all([...connect.rows].filter(([key]) => !incoming.has(key)).map(async ([key, entry]) => {
      if (connect.selection?.key === key) await removeSelection(connect);
      await UI.destroyElement(win, entry.id); connect.rows.delete(key);
    }));
    // Create only new rows. Their handler reads the current network record,
    // because NetworkManager replaces record objects on every refresh.
    const created = await Promise.all(list.map(async (network, index) => {
      if (connect.rows.has(network.key)) return null;
      const entry = { network, snapshot: {} };
      entry.id = await row(win, null, mainWidth(), ROW + 8, () => serial(async () => {
        const current = entry.network;
        if (!current.supported || current.connected) return;
        chosen = chosen?.key === current.key ? undefined : current;
        wifiPassword = '';
        await reconcileConnect();
      }), { colour: () => chosen?.key === entry.network.key ? SURFACE.selected : SURFACE.card,
        cursor: () => entry.network.supported && !entry.network.connected ? 'pointer' : 'default' });
      entry.icon = await icon(win, entry.id, signal(network), 20, 28, ROW + 8);
      const words = await lines(entry.id, network.name, security(network), mainWidth() - 12 - 8 - 28 - 12,
        network.supported ? [TEXT.primary, network.connected ? TEXT.accent : TEXT.secondary] : [TEXT.disabled, TEXT.disabled]);
      entry.heading = words.heading; entry.caption = words.caption;
      await Promise.all([UI.setElementId(win, entry.id, 'installer-network-' + network.name),
        UI.setLayoutOrder(win, entry.id, index * 2 + 1)]);
      entry.snapshot = { name: network.name, signal: signal(network), security: security(network),
        supported: network.supported, connected: network.connected, selected: chosen?.key === network.key, index };
      return { key: network.key, entry };
    }));
    await Promise.all(created.filter(Boolean).map(async built => {
      await UI.attach(win, connect.list, built.entry.id);
      connect.rows.set(built.key, built.entry);
    }));
    await Promise.all(list.map(async (network, index) => {
      const entry = connect.rows.get(network.key), prior = entry.snapshot;
      entry.network = network;
      const selected = chosen?.key === network.key, updates = [];
      if (prior.name !== network.name) {
        updates.push(UI.setTextString(win, entry.heading, network.name));
        updates.push(UI.setElementId(win, entry.id, 'installer-network-' + network.name));
      }
      if (prior.signal !== signal(network)) updates.push(UI.setTexture(win, entry.icon, signal(network)));
      if (prior.security !== security(network)) updates.push(UI.setTextString(win, entry.caption, security(network)));
      if (prior.supported !== network.supported) updates.push(UI.setTextColour(win, entry.heading, network.supported ? TEXT.primary : TEXT.disabled));
      if (prior.supported !== network.supported || prior.connected !== network.connected)
        updates.push(UI.setTextColour(win, entry.caption, !network.supported ? TEXT.disabled : network.connected ? TEXT.accent : TEXT.secondary));
      if (prior.selected !== selected) updates.push(UI.setBoxColour(win, entry.id, selected ? SURFACE.selected : SURFACE.card));
      if (prior.index !== index) updates.push(UI.setLayoutOrder(win, entry.id, index * 2 + 1));
      entry.snapshot = { name: network.name, signal: signal(network), security: security(network),
        supported: network.supported, connected: network.connected, selected, index };
      await Promise.all(updates);
    }));

    if (chosen && (!connect.selection || connect.selection.key !== chosen.key || connect.selection.password !== chosen.password)) {
      await removeSelection(connect);
      const height = (chosen.password ? 2 : 1) * ROW + SPACE.s * 2;
      const surface = await kit.surface('inset', { size: { x: mainWidth(), y: height }, layout: { type: 'column' },
        padding: { t: SPACE.s, r: SPACE.m, b: SPACE.s, l: SPACE.m } });
      let input;
      if (chosen.password) input = await field(surface.content, 'Password', wifiPassword, value => { wifiPassword = value; },
        { password: true, id: 'installer-wifi-password', submit: () => serial(joinChosen) });
      const actions = await UI.createElement(win, { layout: { type: 'row', justifyContent: 'end', alignItems: 'center' }, item: { size: { x: 'auto', y: ROW } } });
      const connectButton = await pill(win, null, 'Connect', ACTION, () => serial(joinChosen), { colour: SURFACE.accent,
        labelColour: TEXT.onAccent, height: 34, onFeedback: value => { view.connectFeedback = value; } });
      await Promise.all([UI.attach(win, actions, connectButton), UI.setElementId(win, connectButton, 'installer-connect')]);
      await UI.attach(win, surface.content, actions);
      await UI.attach(win, connect.list, surface.id);
      connect.selection = { key: chosen.key, password: chosen.password, id: surface.id, height, input };
      if (input) await input.focus();
    }
    if (connect.selection) {
      const index = list.findIndex(network => network.key === connect.selection.key);
      if (connect.selection.index !== index) {
        connect.selection.index = index;
        await UI.setLayoutOrder(win, connect.selection.id, index * 2 + 2);
      }
    }

    const emptyKind = wired && !online ? 'cable' : !wired && !list.length && !scanning && networks.enabled !== false ? 'wifi' : '';
    if (connect.empty?.kind !== emptyKind) {
      if (connect.empty) { await UI.destroyElement(win, connect.empty.id); connect.empty = undefined; }
      if (emptyKind) {
        const empty = await kit.emptyState({ glyph: '/rom/assets/status/' + (emptyKind === 'cable' ? 'ethernet' : 'wifi-off') + '.png',
          message: emptyKind === 'cable' ? 'Connect a network cable' : 'No networks', width: mainWidth(), height: 96 });
        await UI.attach(win, connect.list, empty.id);
        connect.empty = { kind: emptyKind, id: empty.id };
      }
    }
    const pieces = (connect.power ? [ROW + 8 + SPACE.s * 2] : [])
      .concat(list.map(network => ROW + 8 + (connect.selection?.key === network.key ? connect.selection.height + SPACE.s : 0)),
        connect.empty ? [96] : []);
    const height = pieces.reduce((sum, piece) => sum + piece, 0) + Math.max(0, pieces.length - 1) * SPACE.s;
    if (height !== connect.height) {
      bodyFill += height - connect.height; connect.height = height;
      await Promise.all([UI.setLayoutSize(win, connect.list, { x: mainWidth(), y: height }), body.setContentHeight(Math.max(0, bodyFill - SPACE.s))]);
    }
  };
  const removeSelection = async connect => {
    const selection = connect.selection;
    if (!selection) return;
    connect.selection = undefined; view.connectFeedback = undefined;
    if (selection.input) {
      await selection.input.destroy();
      inputs = inputs.filter(input => input !== selection.input);
    }
    await UI.destroyElement(win, selection.id);
  };

  // ---- Timezone picker ---------------------------------------------------------
  // A search field over the matching zones: every row names the city, its
  // country and region, and the time there now. Typing narrows the list
  // without rebuilding the field; Enter takes the top match; a row chooses.
  let results, shown = { height: 0, first: '' };
  const openPicker = async () => {
    if (!zones.length) zones = await api.timezones().catch(() => []);
    picking = true; zoneQuery = ''; error = ''; await render();
  };
  const choosePicked = async zone => {
    if (!zone) return;
    config.timezone = zone; picking = false; view.justPicked = true; await render();
  };
  const paintResults = async () => {
    if (results) { await UI.destroyElement(win, results); bodyFill -= shown.height; }
    const found = searchZones(zones, zoneQuery, config.timezone);
    const height = found.length ? found.length * (ROW + 8) + (found.length - 1) * SPACE.xs : 96;
    results = await UI.createElement(win, { layout: { type: 'column', gap: SPACE.xs }, item: { size: { x: mainWidth(), y: height } } });
    if (!found.length) {
      const empty = await kit.emptyState({ glyph: '/rom/assets/launcher/clear.png', message: 'No matching places', width: mainWidth(), height: 96 });
      await UI.attach(win, results, empty.id);
    }
    for (const item of found) {
      const current = item.zone === config.timezone;
      const target = await row(win, null, mainWidth(), ROW + 8, () => serial(() => choosePicked(item.zone)),
        { colour: current ? SURFACE.selected : SURFACE.card });
      const where = [String(item.country || '').split(', ')[0], item.comment || zoneRegion(item.zone)].filter(Boolean).join(' · ');
      await lines(target, zoneCity(item.zone), where, mainWidth() - 12 - 8 - 130 - 12);
      // The time there, over its offset, flush right.
      const clock = await UI.createElement(win, { layout: { type: 'column', justifyContent: 'center' }, item: { size: { x: 130, y: ROW + 8 } } });
      await text(win, clock, zoneTime(item.offset), TYPE.body, 130, 20, TEXT.primary, FONT, 'right');
      await text(win, clock, offsetLabel(item.offset), TYPE.caption, 130, 18, TEXT.secondary, FONT, 'right');
      await UI.attach(win, target, clock);
      await UI.setElementId(win, target, 'installer-zone-' + item.zone);
      await UI.attach(win, results, target);
    }
    await UI.attach(win, body.content, results);
    shown = { height: height + SPACE.s, first: found[0]?.zone || '' };
    bodyFill += height + SPACE.s;
    await body.setContentHeight(Math.max(0, bodyFill - SPACE.s));
  };
  const pickerPage = async () => {
    results = undefined; shown = { height: 0, first: '' };
    const search = await textInput(win, { width: mainWidth(), height: 40, size: TYPE.body, colour: SURFACE.field, id: 'installer-zone-search',
      placeholder: 'City, country or region', value: zoneQuery, maxLength: 64,
      onInput: value => { zoneQuery = value; serial(paintResults); }, onSubmit: () => serial(() => choosePicked(shown.first)) });
    inputs.push(search);
    await add(search.master.id, 40);
    await paintResults();
    await search.focus();
  };

  // The install page updates in place as stages and output arrive.
  const paintInstall = async animate => {
    const install = view.install;
    if (!install) return;
    const index = install.rows.findIndex(item => item.stage === currentStage);
    const reached = done ? install.rows.length : index;
    await Promise.all(install.rows.map(async (item, i) => {
      const state = done || i < reached ? 'done' : i === reached ? (failed ? 'failed' : 'current') : 'pending';
      if (state === item.state && !animate) return;
      const was = item.state; item.state = state;
      await Promise.all([state === 'current' ? item.spinner.start() : item.spinner.stop(), UI.setEnabled(win, item.dot, state !== 'current'),
        UI.setCircleColour(win, item.dot, state === 'failed' ? HEALTH.warn : state === 'done' ? SURFACE.accent : SURFACE.track),
        UI.setTextColour(win, item.label, state === 'pending' ? TEXT.disabled : state === 'done' ? TEXT.secondary : state === 'failed' ? TEXT.accent : TEXT.primary)]);
      if (state === 'done' && was === 'current') play(item.dot, presets.pop(0, 0.3));
      if (state === 'failed') play(item.label, presets.shake());
    }));
    const progress = Math.round(100 * Math.max(0, reached) / install.rows.length);
    await install.meter.set(Math.max(1, progress), failed ? 'Stopped' : done ? 'Done' : (Math.max(0, reached) + 1) + ' of ' + install.rows.length, animate);
  };

  // ---- Render ---------------------------------------------------------------
  // The picker counts as its own view, between the account page and the next.
  const viewKey = () => PAGES.indexOf(page) + (picking ? 0.5 : 0);
  const valid = () => ({ welcome: true, connect: online, disk: !!config.disk, options: true, encryption: !passphraseError(config, secrets),
    account: !accountError(config, secrets), review: true, complete: true })[page] || false;
  const refreshFooter = () => {
    const ready = valid(), showBack = !installing && (page !== 'install' || failed), showNext = page !== 'install' && !picking;
    const labels = { back: page === 'welcome' ? 'Try it out' : ['install', 'complete'].includes(page) ? 'Close' : 'Back',
      next: page === 'welcome' ? 'Install' : page === 'review' ? 'Erase and install' : page === 'complete' ? 'Shut down' : 'Continue' };
    Promise.all([UI.setEnabled(win, view.back, showBack), UI.setEnabled(win, view.next, showNext),
      UI.setTextString(win, view.backLabel, labels.back), UI.setTextString(win, view.nextLabel, labels.next),
      UI.setBoxColour(win, view.next, ready ? SURFACE.accent : SURFACE.control), UI.setTextColour(win, view.nextLabel, ready ? TEXT.onAccent : TEXT.primary)]).catch(() => {});
    if (ready && view.ready === false && viewKey() === view.shownPage) play(view.next, presets.pop(0, 0.85));
    view.ready = ready;
  };
  const paintStatus = () => view.status ? UI.setTextString(win, view.status, error) : Promise.resolve();
  const render = async () => {
    if (closed) return;
    if (view.welcome !== (page === 'welcome')) await buildChrome();
    const key = viewKey(), turned = key !== view.shownPage, direction = key > view.shownPage ? 1 : -1;
    view.dispose?.(); view.dispose = undefined; view.install = undefined; view.connect = undefined;
    for (const input of inputs) await input.destroy();
    inputs = [];
    if (body) await UI.destroyElement(win, body.id);
    if (view.hero) { await UI.destroyElement(win, view.hero); view.hero = undefined; }
    // Update the hero slot to match the current page.
    await Promise.all([UI.setEnabled(win, view.heroHost, HERO_PAGES.includes(page)),
      UI.setLayoutSize(win, view.heroHost, { x: heroWidth(), y: heroHeight(page) }),
      UI.setLayoutSize(win, view.bodyHost, { x: mainWidth(), y: bodyHeight() })]);
    bodyFill = 0; items = [];
    body = await kit.scrollArea({ width: mainWidth(), height: bodyHeight(), gap: SPACE.s, id: 'installer-body' });
    await UI.attach(win, view.bodyHost, body.id);
    if (picking && page === 'account') await pickerPage(); else { picking = false; await pages[page](); }
    await body.setContentHeight(Math.max(0, bodyFill - SPACE.s));
    // The rail: done steps are quiet accents, the current one leads with a
    // halo, the rest wait.
    // Encryption is on the rail only while the disk is to be encrypted.
    const order = flow(), step = order.indexOf(page);
    await Promise.all(view.steps.map(item => {
      const i = order.indexOf(item.id);
      const state = page === 'complete' || i < step ? 'done' : i === step ? 'current' : 'pending';
      return Promise.all([UI.setEnabled(win, item.line, i >= 0),UI.setCircleColour(win, item.dot, state === 'pending' ? SURFACE.track : SURFACE.accent),
        UI.setEnabled(win, item.halo, state === 'current'),
        UI.setTextColour(win, item.label, state === 'current' ? TEXT.primary : state === 'done' ? TEXT.secondary : TEXT.disabled)]).then(() => {
        if (state === 'current' && turned) play(item.halo, presets.pop(0, 0.3));
      });
    }));
    await Promise.all([UI.setTextString(win, view.title, picking ? 'Timezone' : TITLES[page]), paintStatus()]);
    if (turned) {
      play(view.title, presets.glide({ x: 18 * direction }));
      // On the welcome page the text rises after the koi appears.
      [...(view.hero ? [view.hero] : []), ...items].forEach((id, index) => play(id, presets.rise(index, page === 'welcome' ? 0.3 : 0.04)));
      view.shownPage = key; view.ready = undefined;
    }
    refreshFooter();
  };

  // ---- Actions ---------------------------------------------------------------
  const checkConnection = async () => { online = (await api.connection()).online; };
  const joinChosen = async () => {
    if (!chosen) return;
    const feedback = view.connectFeedback;
    let accepted;
    try {
      await feedback?.begin();
      accepted = await wifi.connect(chosen, chosen.password ? wifiPassword : undefined);
    } finally { await feedback?.end(); }
    if (accepted) { chosen = undefined; wifiPassword = ''; error = ''; await checkConnection(); }
    else { error = wifi.state.error || 'Could not connect'; play(view.status, presets.shake()); }
    await reconcileConnect();
  };
  const goBack = async () => {
    if (installing) return;
    if (picking) { picking = false; await render(); return; }
    if (['welcome', 'install', 'complete'].includes(page)) { await close(); return; }
    const order = flow(); page = order[order.indexOf(page) - 1]; error = ''; await render();
  };
  const refuse = async message => { error = message; await paintStatus(); play(view.status, presets.shake()); };
  const goNext = async () => {
    if (installing || page === 'install') return;
    error = '';
    if (page === 'complete') { await api.shutdown(); if (preview) await refuse('Preview: the computer was not shut down'); return; }
    if (page === 'connect') { await checkConnection(); if (!online) return refuse('Arch or Koya repositories are unreachable'); disks = await api.disks(); }
    if (page === 'disk' && !config.disk) return refuse('Choose a disk');
    if (page === 'encryption') { const reason = passphraseError(config, secrets); if (reason) return refuse(reason); }
    if (page === 'account') { const reason = accountError(config, secrets); if (reason) return refuse(reason); }
    if (page === 'review') {
      // Everything once more: a passphrase entered before encryption was
      // switched back on, say, must not slip through.
      const reason = installError(config, secrets); if (reason) return refuse(reason);
      disks = await api.disks();
      const selected = disks.find(disk => disk.path === config.disk);
      if (!selected || selected.reason || selected.key !== config.diskKey) return refuse('The selected disk changed or is in use. Go back and choose it again.');
      await checkConnection(); if (!online) return refuse('Arch or Koya repositories are unreachable');
      page = 'install'; installing = true; await render();
      try {
        api.install({ ...config }, config.disk, secrets, event => serial(async () => {
          if (event.type === 'log') {
            log = (log + event.message).slice(-16000);
            if (view.logText) await UI.setTextString(win, view.logText, log.slice(-1600));
          } else if (event.type === 'stage') { currentStage = event.stage; await paintInstall(true); }
          else if (event.type === 'complete') { installing = false; done = true; await paintInstall(true); await new Promise(resolve => setTimeout(resolve, 500)); page = 'complete'; await render(); }
          // A failure opens the output: that is what to read next.
          else if (event.type === 'error') { installing = false; failed = true; error = event.message; showLog = true; await render(); await paintInstall(true); }
        }));
      } catch (reason) { installing = false; failed = true; error = reason.message || 'Could not start the installer'; Object.assign(secrets, emptySecrets()); await render(); }
      return;
    }
    if (page === 'disk') view.justChose = '';
    const order = flow(); page = order[order.indexOf(page) + 1]; await render();
  };
  const close = async () => {
    if (installing) return;
    closed = true; wifi?.dispose();
    for (const input of inputs) await input.destroy();
    Object.assign(secrets, emptySecrets()); await destroySurface(win); Engine.quit();
  };
  // Only the live boot launcher enables this. Keep the journal sample to fixed
  // geometry fields and known welcome elements; never log UI text or inputs.
  const geometryFields = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
  const traceBoot = async (phase, event, reflowed, sequence) => {
    if (!bootTrace || closed || page !== 'welcome') return;
    try {
      const time = Date.now();
      const canvas = { ...size };
      const parts = [
        ['line-0', view.welcomeLines?.[0]], ['line-1', view.welcomeLines?.[1]],
        ['line-2', view.welcomeLines?.[2]], ['line-3', view.welcomeLines?.[3]],
        ['hero', view.hero], ['panel', view.panel], ['body-viewport', body?.id],
        ['body-content', body?.content], ['footer', view.footer]
      ].filter(([, id]) => id !== undefined);
      const [windowResult, ...frameResults] = await Promise.allSettled([
        Compositor.getWindowInfo(win), ...parts.map(([, id]) => UI.getElementFrame(win, id))
      ]);
      const window = windowResult.status === 'fulfilled' ? windowResult.value : null;
      Log.info('WELCOME_BOOT_GEOMETRY: ' + JSON.stringify({
        phase, time,
        display: geometryFields(display, ['width', 'height', 'logical_width', 'logical_height', 'scale']),
        requested: requestedSize,
        window: geometryFields(window, ['width', 'height', 'bufferScale', 'fractionalScale']),
        canvas,
        ...(event ? { resizeEvent: geometryFields(event, ['width', 'height']) } : {}),
        ...(sequence !== undefined ? { resizeSequence: sequence } : {}),
        ...(reflowed !== undefined ? { reflowed } : {}),
        frames: Object.fromEntries(parts.map(([name], index) => [name,
          frameResults[index].status === 'fulfilled' ? frameResults[index].value : null]))
      }));
    } catch {
      Log.info('WELCOME_BOOT_TRACE_ERROR: ' + phase);
    }
  };
  let resizeTraceCount = 0, settledResizeTimer;
  Event.on('windowClosed', event => { if (event.id !== win) return; closed = true; wifi?.dispose(); Object.assign(secrets, emptySecrets()); Engine.quit(); });
  // Escape leaves the timezone picker first, then the installer.
  Event.on('keyDown', event => { if (event.id === win && [1, 65307].includes(Number(event.key)) && !installing) serial(picking ? goBack : close); });
  Event.on('windowResized', event => {
    if (event.id !== win || closed) return;
    const welcomeResize = bootTrace && page === 'welcome';
    const sequence = welcomeResize ? ++resizeTraceCount : undefined;
    const traceResize = welcomeResize && sequence <= 8;
    if (welcomeResize) {
      Log.info('WELCOME_BOOT_RESIZE_EVENT: ' + JSON.stringify({
        time: Date.now(), resizeSequence: sequence,
        resizeEvent: geometryFields(event, ['width', 'height']), canvas: { ...size }
      }));
      clearTimeout(settledResizeTimer);
      settledResizeTimer = setTimeout(() => {
        serial(async () => {
          if (sequence === resizeTraceCount) void traceBoot('resize-settled-sample', event, undefined, sequence);
        });
      }, 250);
    }
    serial(async () => {
      const next = await canvasSize();
      const reflowed = next.x !== size.x || next.y !== size.y;
      if (reflowed) {
        size = next; await buildChrome(); view.shownPage = -1; await render();
      }
      if (traceResize) void traceBoot('resize-after-reflow-sample', event, reflowed, sequence);
    });
  });

  const initialRender = rendering.then(async () => { await buildChrome(); await render(); });
  rendering = initialRender.catch(() => {});
  await initialRender;
  if (bootTrace) {
    void traceBoot('initial-render-sample');
    setTimeout(() => { void traceBoot('boot-timer-500ms-sample'); }, 500);
  }
  Log.info('Installer view ready');
  // Reconcile published scan and connection state without replacing the page.
  const onNetworks = value => {
    const connected = value.networks.some(network => network.connected), wasConnected = (networks.networks || []).some(network => network.connected);
    networks = value;
    if (page !== 'connect') return;
    serial(async () => {
      if (connected && !wasConnected) { await checkConnection(); chosen = undefined; wifiPassword = ''; error = ''; }
      await reconcileConnect();
    });
  };
  wifi = preview ? mockWifi(onNetworks, api) : wifiNetwork(onNetworks);
  setTimeout(() => wifi.start().catch(reason => { error = reason.message; serial(paintStatus); }), 0);
  setTimeout(() => serial(async () => { await checkConnection(); await reconcileConnect(); }), 0);
  // While offline on the connect page, keep checking, so a cable plugged in
  // shows up without pressing Continue. Checks never overlap or block the UI,
  // and never repaint under a Wi-Fi password being typed.
  const watchConnection = async () => {
    if (closed) return;
    if (page === 'connect' && !online && !chosen) {
      const now = (await api.connection().catch(() => ({ online: false }))).online;
      if (now && !online && page === 'connect' && !closed) { online = true; error = ''; serial(reconcileConnect); }
    }
    setTimeout(watchConnection, 3000);
  };
  setTimeout(watchConnection, 3000);
  // The zone list loads in the background, so the account page can show the
  // time and offset of the chosen zone before the picker is ever opened.
  setTimeout(() => api.timezones().then(list => { if (!zones.length) zones = list; if (page === 'account' && !picking) serial(render); }).catch(() => {}), 0);
  // Preview automation exposes actions, never entered passwords.
  if (preview) globalThis.koyaInstallerPreview = {
    next: () => serial(goNext), back: () => serial(goBack),
    scan: () => wifi.scan(), idle: () => rendering,
    selectDisk: path => { const disk = disks.find(item => item.path === path); if (disk && !disk.reason) { config.disk = path; config.diskKey = disk.key; } },
    timezone: () => serial(openPicker),
    choose: name => serial(async () => { chosen = (networks.networks || []).find(network => network.name === name); wifiPassword = ''; await reconcileConnect(); }),
    connect: (name, password) => serial(async () => { chosen = (networks.networks || []).find(network => network.name === name); wifiPassword = password || ''; await joinChosen(); }),
    setWifiPassword: value => serial(async () => { wifiPassword = value; await view.connect?.selection?.input?.setValue(value); }),
    wifiPasswordMatches: value => !!view.connect?.selection?.input && wifiPassword === value && view.connect.selection.input.getValue() === value,
    joinSelected: () => serial(joinChosen),
    networks: items => wifi.setNetworks(items),
    fill: values => { Object.assign(config, values.config || {}); Object.assign(secrets, values.secrets || {}); },
    state: () => ({ page, installing, done, failed, error, scanning: wifi?.state?.scanning }), window: win
  };
  return { win, close };
}
