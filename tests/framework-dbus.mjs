import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
fs.mkdirSync(path.join(root, '.work'), {recursive: true});
const work = fs.mkdtempSync(path.join(root, '.work', 'framework-dbus-test-'));
try {
  const payload = root + '/payload';
  const selected = file => new Set(fs.readFileSync(file, 'utf8').split(/\s+/));
  assert(selected(root + '/image/packages.x86_64').has('framework-dbus'), 'live package source selects framework-dbus');
  assert(selected(payload + '/packages.txt').has('framework-dbus'), 'bundled installer selects framework-dbus');
  assert.match(fs.readFileSync(payload + '/SOURCE.txt', 'utf8'), /\bframework-dbus\b/, 'package provenance mentions framework-dbus');

  const repository = fs.readFileSync(payload + '/koya-repository.conf', 'utf8');
  assert.match(repository, /\[koya\][\s\S]*SigLevel = Required[\s\S]*Server = https:\/\/www\.koya-ui\.com\/repository\/\$arch/);

  const target = work + '/target';
  fs.mkdirSync(target + '/etc/pacman.d', {recursive: true});
  const code = `root=$1; work=$2; mnt=$3; payload=$root/payload; apps='[]'
source "$root/backend/packages.sh"
stage(){ :; }
pacman-key(){ :; }
jq(){ :; }
pacstrap(){
  printf '%s\\n' "$@" > "$work/pacstrap.args"
  local config=''
  while (( $# )); do
    if [[ $1 == -C ]]; then config=$2; break; fi
    shift
  done
  [[ -n $config ]]
  cp "$config" "$work/pacstrap.conf.at-call"
}
arch-chroot(){ printf 'chroot %s\\n' "$*"; }
packages_step`;
  const installed = spawnSync('/bin/bash', ['-euc', code, 'test', root, work, target], {encoding: 'utf8'});
  assert.equal(installed.status, 0, installed.stderr);
  const pacstrapArgs = fs.readFileSync(work + '/pacstrap.args', 'utf8').trimEnd().split('\n');
  const configIndex = pacstrapArgs.indexOf('-C');
  assert(configIndex >= 0, 'pacstrap receives -C');
  assert.equal(pacstrapArgs[configIndex + 1], work + '/pacman.conf');
  assert(pacstrapArgs.slice(configIndex + 3).includes('framework-dbus'), 'pacstrap selects framework-dbus');
  const pacstrapConfig = fs.readFileSync(work + '/pacstrap.conf.at-call', 'utf8');
  assert.match(pacstrapConfig, /^\[koya\]\nSigLevel = Required\nServer = https:\/\/www\.koya-ui\.com\/repository\/\$arch$/m,
    'pacstrap config includes the signed Koya repository');
  assert(fs.readFileSync(target + '/etc/pacman.conf', 'utf8').endsWith(repository));
} finally {
  fs.rmSync(work, {recursive: true, force: true});
}
console.log('framework-dbus live and pacstrap selections and repository: passed');
