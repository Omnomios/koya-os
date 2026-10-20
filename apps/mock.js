import * as Process from 'Module/process';
import { emptySecrets, stages } from './model.js';

// Stand-ins for the installation backend and NetworkManager in preview
// (./run.sh --preview). Nothing here touches a disk or a network connection.
// The fixtures behave like the real thing closely enough to exercise every
// screen: networks of different strength, a secured one that refuses the
// wrong password, disks that cannot be used, and a staged installation with
// command output that can be told to fail.
//
//   KOYA_INSTALLER_MOCK_ONLINE=1     start with a wired connection
//   KOYA_INSTALLER_MOCK_FAIL=<stage> stop the installation at that stage
//   KOYA_INSTALLER_MOCK_SPEED=<n>    installation speed multiplier (default 1)
//   KOYA_INSTALLER_MOCK_WIFI=none    a computer without a Wi-Fi device
//   KOYA_INSTALLER_MOCK_CABLE=<s>    a network cable is plugged in after s seconds
export const PREVIEW_WIFI_PASSWORD = 'koya-preview';
const env = (name, fallback = '') => Process.getEnv(name, fallback);
const later = (ms, fn) => setTimeout(fn, ms);

// The same words the real backend uses for each stage.
const messages = {
  preflight: 'Checking the installation', partition: 'Partitioning the selected disk',
  encrypt: 'Encrypting the root filesystem', format: 'Formatting and mounting the filesystems', packages: 'Installing Arch Linux and desktop packages',
  runtime: 'Installing Koya Shell', account: 'Creating your account',
  desktop: 'Configuring the desktop and greeter', wallpaper: 'Preparing the theme and login wallpaper',
  services: 'Configuring networking, sound and boot services', boot: 'Installing the bootloader and boot image',
  finish: 'Syncing files and releasing the installation disk'
};
// A few lines of plausible output per stage, and how long each takes (ms).
const output = {
  preflight: [['Checking the destination', 300], ['Arch and Koya repositories reachable', 300]],
  partition: [['wipefs: erased signatures', 300], ['Creating GPT: 512 MiB EFI, root', 400]],
  encrypt: [['Formatting LUKS2 container', 500]],
  format: [['mkfs.ext4: creating filesystem', 400], ['Mounting root and EFI filesystems', 200]],
  packages: [[':: Synchronizing package databases...', 400], ['downloading linux-7.2.10.arch1-1', 700], ['downloading hyprland-0.56.2-4', 600],
    ['installing 412 packages', 900], ['(412/412) checking package integrity', 500]],
  runtime: [['Installing koya...', 400], ['Installing helix-plugins...', 400], ['Installing koya-shell...', 400]],
  account: [['useradd: account created', 300], ['sudo: wheel group enabled', 200]],
  desktop: [['Applying desktop configuration', 400], ['Configuring the greeter', 400]],
  wallpaper: [['Rendering the login wallpaper cache', 500]],
  services: [['Enabled NetworkManager, greetd, upower', 400]],
  boot: [['systemd-boot installed', 400], ['mkinitcpio: image generation successful', 600]],
  finish: [['Syncing filesystems', 400], ['Unmounted /mnt', 200]]
};

export function mockBackend() {
  let busy = false, online = env('KOYA_INSTALLER_MOCK_ONLINE') === '1';
  const speed = Math.max(0.1, Number(env('KOYA_INSTALLER_MOCK_SPEED', '1')) || 1);
  const cable = Number(env('KOYA_INSTALLER_MOCK_CABLE'));
  if (cable > 0) later(cable * 1000, () => { online = true; });
  return {
    // Wi-Fi joining (mockWifi) brings the preview online.
    set online(value) { online = !!value; },
    async disks() {
      return [
        { path: '/dev/nvme0n1', key: 'preview-nvme', transport: 'nvme', model: 'Samsung SSD 990 PRO', size: 1000204886016, reason: '' },
        { path: '/dev/vda', key: 'preview-ssd', model: 'Preview SSD', size: 512107339776, reason: '' },
        { path: '/dev/sda', key: 'preview-usb', transport: 'usb', model: 'Koya installation USB', size: 64000000000, reason: 'Contains the installer' },
        { path: '/dev/sdb', key: 'preview-backup', transport: 'usb', model: 'WD Elements', size: 2000398934016, reason: 'Mounted at /run/media/backup' }
      ];
    },
    async connection() { return { arch: online, koya: online, online }; },
    // A cross-section of real zones, as backend/timezones.sh reports them.
    async timezones() {
      return [
        ['Australia/Sydney', 'Australia', 'New South Wales (most areas)', '+1100'], ['Australia/Melbourne', 'Australia', 'Victoria', '+1100'],
        ['Australia/Brisbane', 'Australia', 'Queensland (most areas)', '+1000'], ['Australia/Adelaide', 'Australia', 'South Australia', '+1030'],
        ['Australia/Hobart', 'Australia', 'Tasmania', '+1100'], ['Australia/Darwin', 'Australia', 'Northern Territory', '+0930'],
        ['Australia/Perth', 'Australia', 'Western Australia (most areas)', '+0800'], ['Pacific/Auckland', 'New Zealand', 'New Zealand time', '+1300'],
        ['Asia/Tokyo', 'Japan', '', '+0900'], ['Asia/Singapore', 'Singapore, Malaysia', '', '+0800'], ['Asia/Hong_Kong', 'Hong Kong', '', '+0800'],
        ['Asia/Kolkata', 'India', '', '+0530'], ['Asia/Dubai', 'United Arab Emirates, Oman', '', '+0400'],
        ['Europe/London', 'Britain (UK), Guernsey, Isle of Man, Jersey', '', '+0100'], ['Europe/Berlin', 'Germany, Denmark, Norway, Sweden', 'most of Germany', '+0200'],
        ['Europe/Paris', 'France, Monaco', '', '+0200'], ['Europe/Kyiv', 'Ukraine', 'most of Ukraine', '+0300'],
        ['Africa/Johannesburg', 'South Africa, Lesotho, Eswatini', '', '+0200'], ['America/Sao_Paulo', 'Brazil', 'Brazil (southeast: GO, DF, MG, ES, RJ, SP, PR, SC, RS)', '-0300'],
        ['America/New_York', 'United States', 'Eastern (most areas)', '-0400'], ['America/Chicago', 'United States', 'Central (most areas)', '-0500'],
        ['America/Denver', 'United States', 'Mountain (most areas)', '-0600'], ['America/Los_Angeles', 'United States', 'Pacific', '-0700'],
        ['America/Toronto', 'Canada, Bahamas', 'Eastern - ON & QC (most areas)', '-0400'], ['UTC', '', 'Coordinated Universal Time', '+0000']
      ].map(([zone, country, comment, offset]) => ({ zone, country, comment, offset }));
    },
    install(config, confirmation, secrets, receive) {
      if (busy) throw new Error('Installation is already running');
      busy = true;
      Object.assign(secrets, emptySecrets());
      const fail = env('KOYA_INSTALLER_MOCK_FAIL');
      const plan = stages.filter(stage => stage !== 'encrypt' || config.encrypt);
      let index = 0;
      const next = () => {
        if (index === plan.length) { busy = false; receive({ type: 'complete', stage: 'finish', message: 'Preview complete — no disks were changed' }); return; }
        const stage = plan[index++];
        receive({ type: 'stage', stage, message: messages[stage] });
        const lines = [...(output[stage] || [])];
        const line = () => {
          if (stage === fail && !lines.length) {
            busy = false;
            receive({ type: 'log', message: 'error: failed to commit transaction (preview failure)\n' });
            receive({ type: 'error', stage, message: messages[stage] + ' failed' });
            return;
          }
          if (!lines.length) { next(); return; }
          const [text, ms] = lines.shift();
          later(ms / speed, () => { receive({ type: 'log', message: text + '\n' }); line(); });
        };
        line();
      };
      later(0, next);
    },
    async shutdown() {}
  };
}

// NetworkManager as wifi-network.js presents it: the same state shape,
// start/scan/connect/toggle/dispose.
export function mockWifi(changed = () => {}, backend) {
  const fixtures = [
    { name: 'Koya Studio', Strength: 92, security: 'wpa-psk' },
    { name: 'Café Wi-Fi', Strength: 64, security: 'open' },
    { name: 'Office', Strength: 38, security: 'sae' },
    { name: 'eduroam', Strength: 30, security: 'enterprise' }
  ].map(item => ({ ...item, key: item.name + ':' + item.security, ssid: [...item.name].map(c => c.charCodeAt(0)),
    password: ['wpa-psk', 'sae'].includes(item.security), supported: item.security !== 'enterprise', connected: false, saved: false }));
  let state = { available: true, enabled: true, hardware: true, loading: true, scanning: false, working: false, networks: [], error: '', message: '' };
  let closed = false;
  // No device: the shape wifi-network.js publishes when NetworkManager has no
  // wireless device, and nothing to scan or join.
  if (env('KOYA_INSTALLER_MOCK_WIFI') === 'none') {
    state = { ...state, available: false, enabled: false, loading: false, message: 'No Wi-Fi device' };
    return { get state() { return state; }, start: async () => { if (!closed) changed(state); }, scan: async () => {},
      connect: async () => false, toggle: async () => {}, clearError: () => {}, dispose: () => { closed = true; } };
  }
  const publish = next => { state = { ...state, ...next }; if (!closed) changed(state); };
  const list = connected => fixtures.map(item => ({ ...item, connected: item.key === connected }))
    .sort((a, b) => Number(b.connected) - Number(a.connected) || b.Strength - a.Strength);
  let connected = '';
  return {
    get state() { return state; },
    start: async () => { later(600, () => publish({ loading: false, networks: list(connected) })); },
    scan: async () => {
      if (state.scanning) return;
      publish({ scanning: true, error: '', message: '' });
      later(1200, () => publish({ scanning: false, networks: list(connected) }));
    },
    connect: async (network, password) => {
      publish({ working: true, error: '', message: '' });
      await new Promise(resolve => later(1400, resolve));
      if (network.password && password !== PREVIEW_WIFI_PASSWORD) {
        publish({ working: false, error: 'Could not authenticate. Check the password and try again.' });
        return false;
      }
      connected = network.key; if (backend) backend.online = true;
      publish({ working: false, message: 'Connected', networks: list(connected) });
      return true;
    },
    toggle: async () => publish({ enabled: !state.enabled, networks: state.enabled ? [] : list(connected) }),
    clearError: () => publish({ error: '', message: '' }),
    dispose: () => { closed = true; }
  };
}
