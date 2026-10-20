import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
const root = new URL('..', import.meta.url).pathname;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'koya-image-test-'));
try {
  const result = spawnSync(root + '/tools/prepare-image.sh', [work, 'test'], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const profile = work + '/profile', live = profile + '/airootfs', app = live + '/opt/koya-installer';
  assert(fs.existsSync(app + '/apps/theme-ui.js'));
  assert(fs.existsSync(app + '/boot/installer.js'));
  assert(fs.existsSync(app + '/assets/fonts/Inter-Regular.ttf'));
  assert(!fs.existsSync(app + '/payload/koya-bar.tar'));
  assert(!fs.existsSync(app + '/shared'));
  assert(!fs.existsSync(live + '/etc/systemd/system/weston.service'));
  assert(!fs.existsSync(live + '/etc/systemd/system/koya-installer.service'));
  assert(!fs.existsSync(app + '/.git'));
  assert(!fs.existsSync(app + '/.work'));
  assert.equal(fs.readFileSync(app + '/IMAGE_VERSION', 'utf8'), 'test\n');
  assert.equal(fs.readlinkSync(live + '/etc/systemd/system/default.target'), '/usr/lib/systemd/system/graphical.target');
  assert.equal(fs.readlinkSync(live + '/etc/localtime'), '/usr/share/zoneinfo/UTC');
  assert.equal(fs.readlinkSync(live + '/etc/systemd/system/display-manager.service'), '/usr/lib/systemd/system/greetd.service');
  const greetd = fs.readFileSync(live + '/etc/greetd/config.toml', 'utf8');
  assert.match(greetd, /\[initial_session\][\s\S]*user = "live"/);
  assert.match(greetd, /\[default_session\][\s\S]*koya-greeter/);
  assert.match(fs.readFileSync(live + '/etc/systemd/system/greetd.service.d/live.conf', 'utf8'), /Requires=koya-live-setup.service/);
  assert.equal(fs.readFileSync(live + '/etc/koya-live', 'utf8'), 'test\n');
  const packages = new Set(fs.readFileSync(profile + '/packages.x86_64', 'utf8').trim().split('\n'));
  for (const name of ['koya-shell', 'hyprland', 'greetd', 'polkit', 'pipewire-pulse', 'firefox', 'nautilus', 'kitty', 'pavucontrol', 'grim']) assert(packages.has(name), name);
  assert(!packages.has('weston'));
  const hypr = fs.readFileSync(live + '/etc/skel/.config/hypr/hyprland.lua', 'utf8');
  assert(hypr.includes('/usr/bin/koya-shell'));
  assert(hypr.includes('/.config/hypr/live.lua'));
  assert(!hypr.includes('AQ_DRM_DEVICES'));
  assert(!hypr.includes('hl.exec_cmd("hypridle")'));
  const liveHypr = fs.readFileSync(live + '/etc/skel/.config/hypr/live.lua', 'utf8');
  assert.match(liveHypr, /hl\.exec_cmd\("\/usr\/local\/bin\/koya-installer"\)/);
  assert.match(liveHypr, /float = true/);
  assert(fs.existsSync(live + '/etc/skel/.local/share/koya-bar/wallpapers/catching-the-desert.jpeg'));
  assert.match(fs.readFileSync(live + '/usr/share/applications/koya-installer.desktop', 'utf8'), /Exec=\/usr\/local\/bin\/koya-installer/);
  assert.match(fs.readFileSync(live + '/usr/share/polkit-1/actions/org.koya.installer.policy', 'utf8'), /\/opt\/koya-installer\/backend\/install.sh/);
  let authorize;
  vm.runInNewContext(fs.readFileSync(live + '/etc/polkit-1/rules.d/49-koya-live.rules', 'utf8'), {
    polkit: { addRule: rule => { authorize = rule; }, Result: { YES: 'yes' } }
  });
  const action = { id: 'org.koya.installer.install' }, subject = { user: 'live', local: true, active: true };
  assert.equal(authorize(action, subject), 'yes');
  for (const denied of [{ ...subject, user: 'someone' }, { ...subject, local: false }, { ...subject, active: false }]) assert.equal(authorize(action, denied), undefined);
  assert.equal(authorize({ id: 'unrelated.action' }, subject), undefined);
  for (const file of ['/usr/local/bin/koya-installer', '/usr/local/bin/koya-live-session', '/usr/local/libexec/koya-live-setup']) {
    assert(fs.statSync(live + file).mode & 0o111);
    const syntax = spawnSync('bash', ['-n', live + file], {encoding:'utf8'});
    assert.equal(syntax.status, 0, syntax.stderr);
  }
  assert.equal(fs.statSync(live + '/etc/sudoers.d/10-koya-live').mode & 0o777, 0o440);
  assert(!fs.readFileSync(live + '/etc/pacman.conf', 'utf8').includes(work));
  assert(!fs.readFileSync(live + '/etc/pacman.conf', 'utf8').includes('koya-live'));
  const repository = fs.readFileSync(root + '/payload/koya-repository.conf', 'utf8');
  for (const config of [profile + '/pacman.conf', live + '/etc/pacman.conf']) {
    const text = fs.readFileSync(config, 'utf8');
    assert(text.endsWith(repository));
    assert(!text.includes('file://'));
    assert.equal((text.match(/\[koya\]/g) || []).length, 1);
  }
  assert(!fs.existsSync(work + '/repository'));
  // The application is on overlayfs, but the installation USB is /dev/sdb.
  const code = `source "$1/backend/disks.sh"
payload=/opt/koya-installer/payload
findmnt() { case "$*" in *bootmnt*) echo 8:17 ;; *) echo 0:42 ;; esac; }
lsblk() { printf '%s' '{"blockdevices":[{"path":"/dev/sdb","type":"disk","size":64000000000,"ro":false,"maj:min":"8:16","children":[{"path":"/dev/sdb1","type":"part","maj:min":"8:17"}]}]}'; }
inventory`;
  const inventory = spawnSync('/bin/bash', ['-euc', code, 'test', root], {encoding:'utf8'});
  assert.equal(inventory.status, 0, inventory.stderr);
  assert.equal(JSON.parse(inventory.stdout)[0].reason, 'Contains the installer');
  const copiedToRam = code.replace('inventory', `findmnt() { echo 0:42; }
tr() { echo archisosearchuuid=fixture-live-uuid; }
inventory`).replace('"type":"part","maj:min":"8:17"', '"type":"part","maj:min":"8:17","uuid":"fixture-live-uuid"');
  const ramInventory = spawnSync('/bin/bash', ['-euc', copiedToRam, 'test', root], {encoding:'utf8'});
  assert.equal(ramInventory.status, 0, ramInventory.stderr);
  assert.equal(JSON.parse(ramInventory.stdout)[0].reason, 'Contains the installer');
} finally { fs.rmSync(work, {recursive:true, force:true}); }
console.log('Image assembly, official repository and live USB protection: passed');
