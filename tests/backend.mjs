import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const root=new URL('..',import.meta.url).pathname;
for(const file of fs.readdirSync(root+'/backend').filter(file=>file.endsWith('.sh'))){
 const result=spawnSync('/bin/bash',['-n',root+'/backend/'+file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
}
// Inspect real storage only; this mode cannot reach formatting commands.
const inventory=spawnSync(root+'/backend/install.sh',['--disks'],{encoding:'utf8'});
if(inventory.status===0){
 const disks=JSON.parse(inventory.stdout);
 for(const disk of disks.filter(disk=>disk.reason)){
  const result=spawnSync(root+'/install.sh',[disk.path,'--plan'],{encoding:'utf8'});
  assert.notEqual(result.status,0,'In-use and source disks must be refused');
 }
}else if(!/Operation not permitted|Permission denied/.test(inventory.stderr))assert.fail(inventory.stderr);
const invalid=spawnSync(root+'/install.sh',['/dev/does-not-exist','--user','root','--plan'],{encoding:'utf8'});
assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/Invalid user/);
// Exercise the boot writer against a temporary root, with chroot commands
// suppressed. Both real branches must produce consistent hooks and UUIDs.
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'koya-boot-test-'));
try{
 for(const encrypt of ['true','false']){
  const target=directory+'/'+encrypt;fs.mkdirSync(target+'/etc',{recursive:true});fs.mkdirSync(target+'/boot',{recursive:true});
  fs.writeFileSync(target+'/etc/mkinitcpio.conf','HOOKS=(base)\n');
  const code='source "$1/backend/boot.sh"; mnt=$2; encrypt=$3; cryptuuid=fixture-crypt; rootuuid=fixture-root; stage(){ :; }; arch-chroot(){ :; }; boot_step';
  const result=spawnSync('/bin/bash',['-euc',code,'test',root,target,encrypt],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const entry=fs.readFileSync(target+'/boot/loader/entries/koya.conf','utf8'),hooks=fs.readFileSync(target+'/etc/mkinitcpio.conf','utf8');
  assert(entry.includes('root=UUID=fixture-root'));
  assert.equal(entry.includes('cryptdevice='),encrypt==='true');assert.equal(hooks.includes(' encrypt '),encrypt==='true');
 }
}finally{fs.rmSync(directory,{recursive:true,force:true});}
console.log('Installer syntax and disk refusal checks: passed');

// Exercise storage control flow without accessing disks: replace only the
// block-device assertion, and stub every command that could modify storage.
const storage=fs.readFileSync(root+'/backend/storage.sh','utf8').replace(
 '[[ -b $efi && -b $rootpart ]]', '[[ $efi == fixture-efi && $rootpart == fixture-root ]]');
for (const encrypt of ['true','false']) {
 for (const failure of ['', 'format', 'root', 'efi']) {
  const code=`set -euo pipefail
encrypt=$1; failure=$2; gui=true; disk=fixture-disk; efi=fixture-efi; rootpart=fixture-root
mnt=fixture-target; mapper=fixture-mapper; luks_passphrase=fixture-password
stage(){ printf 'stage %s\\n' "$1"; }
die(){ printf '%s\\n' "$*" >&2; exit 1; }
sgdisk(){ :; }; partprobe(){ :; }; udevadm(){ :; }; mkfs.fat(){ :; }; mkdir(){ :; }
cryptsetup(){ printf 'cryptsetup %s\\n' "$1"; }
mkfs.ext4(){ [[ $failure != format ]]; }
mount(){ if [[ $1 == fixture-efi ]]; then [[ $failure != efi ]]; else [[ $failure != root ]]; fi; }
${storage}
storage_step
printf 'mounted %s %s %s\\n' "$root_device" "$root_mounted" "$efi_mounted"`;
  const result=spawnSync('/bin/bash',['-c',code,'test',encrypt,failure],{encoding:'utf8'});
  assert.equal(result.status,failure ? 1 : 0,result.stderr);
  assert.equal(result.stdout.includes('stage encrypt'),encrypt==='true');
  assert.equal(result.stdout.includes('cryptsetup'),encrypt==='true');
  assert.match(result.stdout,/stage format/);
  if(failure) {
   assert.match(result.stderr,new RegExp({format:'Could not format root',root:'Could not mount root',efi:'Could not mount EFI'}[failure]));
   assert(!result.stdout.includes('mounted '));
  } else assert.match(result.stdout,new RegExp('mounted '+(encrypt==='true'?'/dev/mapper/fixture-mapper':'fixture-root')+' true true'));
 }
}
console.log('Storage branches and formatting/mount failure diagnostics: passed');

// A silent command failure must identify its source and exit status in both
// the diagnostic stream and GUI event, including inside a sourced function.
const failureWork=fs.mkdtempSync(path.join(os.tmpdir(),'koya-failure-test-'));
try {
 const controller=fs.readFileSync(root+'/backend/install.sh','utf8').split('\ncase ${1:-} in')[0]
  .replace(/^root=.*$/m,'root=$1');
 for(const explicit of [false,true]) {
  const file=path.join(failureWork,'controller.sh');
  fs.writeFileSync(file,controller+`
gui=true; encrypt=false
trap cleanup EXIT
sgdisk(){ :; }
partprobe(){ return 19; }
${explicit ? "die 'Fixture formatting failure'" : 'storage_step'}
`);
  const result=spawnSync('/bin/bash',[file,root],{encoding:'utf8'});
  assert.equal(result.status,explicit ? 1 : 19,result.stderr);
  const events=result.stdout.trim().split('\n').map(line=>JSON.parse(line));
  const failure=events.at(-1);
  assert.equal(failure.type,'error');
  assert.match(failure.message,explicit ? /Fixture formatting failure/ : /storage\.sh:\d+, exit status 19/);
  assert(result.stderr.includes(failure.message));
  assert(!result.stdout.includes('fixture-password'));
 }
} finally {fs.rmSync(failureWork,{recursive:true,force:true});}
console.log('Silent shell failure location and GUI diagnostics: passed');

// Exercise package setup without downloading, chrooting or touching real disks.
// The live verification keyring must be ready before pacstrap starts.
const packageWork=fs.mkdtempSync(path.join(os.tmpdir(),'koya-package-test-'));
try {
 const target=packageWork+'/target';
 fs.mkdirSync(target+'/etc/pacman.d',{recursive:true});
 const code=`root=$1; work=$2; mnt=$3; payload=$root/payload; apps='[]'
source "$root/backend/packages.sh"
stage(){ :; }
pacman-key(){ printf 'live-key %s\\n' "$*"; }
pacstrap(){ printf 'pacstrap %s\\n' "$*"; }
arch-chroot(){ printf 'target %s\\n' "$*"; }
packages_step`;
 const result=spawnSync('/bin/bash',['-euc',code,'test',root,packageWork,target],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 const lines=result.stdout.trim().split('\n');
 assert.deepEqual(lines.slice(0,2),['live-key --init','live-key --populate archlinux']);
 assert.match(lines[2],/^live-key --add /);
 assert.match(lines[3],/^live-key --lsign-key /);
 assert.match(lines[4],/^pacstrap -K -M -C /);
 assert(fs.readFileSync(target+'/etc/pacman.conf','utf8').endsWith(fs.readFileSync(root+'/payload/koya-repository.conf','utf8')));
 assert.match(lines.at(-1),/pacman -Syu --noconfirm --needed koya\/koya-shell$/);
} finally {fs.rmSync(packageWork,{recursive:true,force:true});}
console.log('Live keyring preparation and target repository: passed');

const greeterWork=fs.mkdtempSync(path.join(os.tmpdir(),'koya-greeter-install-test-'));
try {
 for(const supportsActivation of [true,false]) {
  const target=greeterWork+'/'+(supportsActivation?'fresh':'older');
  const helper=target+'/usr/share/koya-shell/install-fingerprint.py';
  fs.mkdirSync(path.dirname(helper),{recursive:true});
  fs.mkdirSync(target+'/etc/greetd',{recursive:true});
  fs.writeFileSync(target+'/etc/greetd/config.toml','old package config\n');
  fs.writeFileSync(helper,supportsActivation
   ? 'parser.add_argument("--package-activate")\n'
   : 'parser.add_argument("--package-activate-old")\n');
  const code=`root=$1; payload=$root/payload; mnt=$2
source "$root/backend/desktop.sh"
arch-chroot(){
 node -e 'const fs=require("node:fs"); for(let i=1;i<process.argv.length;i+=2) if(!fs.readFileSync(process.argv[i]).equals(fs.readFileSync(process.argv[i+1]))) process.exit(1)' \
  "$payload/greeter/config.toml" "$mnt/etc/greetd/config.toml" \
  "$payload/greeter/koya-greetd" "$mnt/usr/local/libexec/koya-greetd" \
  "$payload/greeter/koya-greeter-autologin" "$mnt/usr/local/libexec/koya-greeter-autologin" || return 1
 printf 'chroot %s\\n' "$*"
}
systemctl(){ printf 'systemctl %s\\n' "$*"; }
configure_greeter`;
  const result=spawnSync('/bin/bash',['-euc',code,'test',root,target],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const lines=result.stdout.trim().split('\n');
  const activation=`chroot ${target} /usr/bin/python3 /usr/share/koya-shell/install-fingerprint.py --package-activate --platform arch`;
  assert.deepEqual(lines,supportsActivation
   ? [activation,`systemctl --root=${target} enable greetd.service`]
   : [`systemctl --root=${target} enable greetd.service`]);
  assert.equal(fs.readFileSync(target+'/etc/greetd/config.toml','utf8'),fs.readFileSync(root+'/payload/greeter/config.toml','utf8'));
  assert.equal(fs.readFileSync(target+'/etc/systemd/system/greetd.service.d/koya.conf','utf8'),fs.readFileSync(root+'/payload/greeter/greetd-koya.conf','utf8'));
  for(const wrapper of ['koya-greetd','koya-greeter-autologin']) {
   assert.equal(fs.readFileSync(target+'/usr/local/libexec/'+wrapper,'utf8'),fs.readFileSync(root+'/payload/greeter/'+wrapper,'utf8'));
   assert(fs.statSync(target+'/usr/local/libexec/'+wrapper).mode & 0o111);
  }
  assert(!fs.existsSync(target+'/usr/local/bin/koya-greeter'));
 }
 const hypr=fs.readFileSync(root+'/payload/profile/config/hypr/hyprland.lua','utf8');
 assert(hypr.includes('hl.exec_cmd("/usr/bin/koya-shell")'));
 assert(!hypr.includes('projects/koya-bar'));
} finally {fs.rmSync(greeterWork,{recursive:true,force:true});}
console.log('Packaged greeter and desktop wiring: passed');
