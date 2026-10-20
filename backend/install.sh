#!/bin/bash
set -Eeuo pipefail
umask 022
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
payload=${KOYA_INSTALLER_PAYLOAD:-$root/payload}
gui=false phase=preflight disk= disk_key= username=user hostname=koya timezone=Australia/Sydney encrypt=true
apps='["firefox","files","audio","screenshots"]' root_device= cryptuuid= rootuuid=
completed=false mapped=false root_mounted=false efi_mounted=false work= mnt= mapper= failure_message=
exec 3>&1
emit() { if $gui; then jq -nc --arg type "$1" --arg stage "$phase" --arg message "${2:-}" '{type:$type,stage:$stage,message:$message}' >&3; fi; }
stage() { phase=$1; if $gui; then emit stage "$2"; else printf '\n[+] %s\n' "$2" >&3; fi; }
die() { failure_message=$*; printf 'Error: %s\n' "$failure_message" >&2; exit 1; }
# errexit alone can stop on a command that writes no diagnostic. Record only
# its source location and status: command arguments may contain credentials.
report_failure() {
  local status=$1 file=${2##*/} line=$3
  failure_message="Installation stopped during $phase ($file:$line, exit status $status)."
  printf 'Error: %s\n' "$failure_message" >&2
}
trap 'report_failure "$?" "${BASH_SOURCE[0]}" "$LINENO"' ERR
source "$root/backend/disks.sh"
for component in storage packages account desktop services boot; do source "$root/backend/$component.sh"; done
validate_config() {
  [[ $username =~ ^[a-z_][a-z0-9_-]{0,30}$ && $username != root ]] || die 'Invalid user name'
  [[ $hostname =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$ ]] || die 'Invalid hostname'
  [[ ${#timezone} -le 128 && $timezone != /* && $timezone != *..* && -f /usr/share/zoneinfo/$timezone ]] || die 'Invalid timezone'
  [[ $encrypt == true || $encrypt == false ]] || die 'Invalid encryption setting'
  jq -e 'type == "array" and all(.[]; type == "string" and (. == "firefox" or . == "files" or . == "audio" or . == "screenshots"))' <<< "$apps" >/dev/null || die 'Invalid optional applications'
}
read_frame() {
  local line
  IFS= read -r -t 120 -n 4097 line || die 'Installer input disconnected or timed out'
  (( ${#line} <= 4096 )) || die 'Installer request is too large'
  jq -ce . <<< "$line" || die 'Invalid installer request'
}
secret() {
  local frame value
  emit secret "$1"
  frame=$(read_frame)
  jq -e --arg name "$1" '.type == "secret" and .name == $name and (.value | type == "string" and length >= 8 and length <= 512 and (test("[\u0000-\u001f\u007f]") | not))' <<< "$frame" >/dev/null || die 'Invalid password response'
  value=$(jq -r .value <<< "$frame")
  printf -v "$1" '%s' "$value"
  unset frame value
}
cleanup() {
  local status=$?
  trap - EXIT PIPE ERR
  unset account_password luks_passphrase
  if $efi_mounted; then umount "$mnt/boot" || status=1; fi
  if $root_mounted; then umount "$mnt" || status=1; fi
  if $mapped; then cryptsetup close "$mapper" || status=1; fi
  if (( status == 0 )) && $completed; then emit complete 'Installation complete';
  elif (( status != 0 )); then emit error "${failure_message:-Installation stopped during $phase (exit status $status). See diagnostic output.}"; fi
  exit "$status"
}
preflight() {
  (( EUID == 0 )) || die 'Installation requires root'
  [[ $(uname -m) == x86_64 && -d /sys/firmware/efi ]] || die 'Boot this x86_64 installer in UEFI mode'
  for tool in pacstrap arch-chroot sgdisk partprobe udevadm cryptsetup mkfs.fat mkfs.ext4 mount umount \
    blkid findmnt lsblk blockdev gpg curl pacman pacman-key tar sha256sum timeout flock jq; do
    command -v "$tool" >/dev/null || die "Missing installer tool: $tool"
  done
  exec 9>/run/lock/koya-installer.lock
  chmod 600 /run/lock/koya-installer.lock
  flock -n 9 || die 'Another installation is already running'
  validate_config
  validate_disk
  (cd "$payload" && sha256sum --check --quiet SHA256SUMS) || die 'Installer payload verification failed'
  "$root/backend/network.sh" >/dev/null || die 'Connect to the internet before installing'
  work=$(mktemp -d /tmp/koya-install.XXXXXX)
  mnt=$work/root mapper=koya-install-$$
  mkdir -m 700 "$work/gnupg"
  local actual
  actual=$(gpg --batch --homedir "$work/gnupg" --show-keys --with-colons "$payload/koya-packages.pub" 2>/dev/null | awk -F: '$1 == "fpr" {print $10; exit}')
  [[ $actual == 06089A97B6D66C69BFD021F0DF7B60698EF57FF3 ]] || die 'Koya signing-key fingerprint does not match'
}
install_system() {
  stage preflight 'Checking the installation'
  preflight
  validate_disk
  storage_step
  packages_step
  account_step
  desktop_step
  services_step
  boot_step
  stage finish 'Syncing files and releasing the installation disk'
  sync
  completed=true
}

case ${1:-} in
  --disks) inventory; exit ;;
  --timezones) find /usr/share/zoneinfo -type f ! -path '*/posix/*' ! -path '*/right/*' | sed 's|/usr/share/zoneinfo/||' | sort; exit ;;
  --gui)
    gui=true
    trap cleanup EXIT; trap 'exit 130' INT; trap 'exit 143' TERM; trap 'exit 74' PIPE
    emit ready
    request=$(read_frame)
    jq -e '.type == "install" and (.config|type=="object") and (.confirmation|type=="string")' <<< "$request" >/dev/null || die 'Invalid install request'
    disk=$(jq -er '.config.disk|select(type=="string")' <<< "$request")
    disk_key=$(jq -er '.config.diskKey|select(type=="string" and length>0)' <<< "$request")
    username=$(jq -er '.config.username|select(type=="string")' <<< "$request")
    hostname=$(jq -er '.config.hostname|select(type=="string")' <<< "$request")
    timezone=$(jq -er '.config.timezone|select(type=="string")' <<< "$request")
    encrypt=$(jq -r '.config.encrypt|select(type=="boolean")' <<< "$request")
    apps=$(jq -ce '.config.apps' <<< "$request")
    [[ $(jq -r .confirmation <<< "$request") == "$disk" ]] || die 'Disk confirmation does not match'
    unset request
    validate_config; validate_disk
    secret account_password
    if $encrypt; then secret luks_passphrase; fi
    emit accepted
    install_system >&2
    ;;
  --help|-h|'') printf 'Usage: ./install.sh /dev/DISK [--user NAME] [--hostname NAME] [--timezone AREA/CITY] [--plan]\n'; exit ;;
  *)
    disk=$1; shift
    plan=false
    while (( $# )); do
      case $1 in
        --plan) plan=true; shift ;;
        --no-encryption) encrypt=false; shift ;;
        --user|--hostname|--timezone|--apps)
          (( $#>=2 )) || die 'Missing option value'
          case $1 in --user) username=$2 ;; --hostname) hostname=$2 ;; --timezone) timezone=$2 ;; --apps) apps=$(jq -nc --arg value "$2" '$value|if . == "none" then [] else split(",") end') ;; esac; shift 2 ;;
        *) die "Unknown argument: $1" ;;
      esac
    done
    validate_config; validate_disk
    if $plan; then printf 'EFI: %s (512 MiB FAT32)\nRoot: %s (remaining space, ext4)\nEncryption: %s\nUser: %s\nHostname: %s\nTimezone: %s\nApps: %s\n' "$efi" "$rootpart" "$encrypt" "$username" "$hostname" "$timezone" "$apps"; exit; fi
    [[ -t 0 ]] || die 'CLI installation requires an interactive terminal'
    trap cleanup EXIT; trap 'exit 130' INT; trap 'exit 143' TERM
    install_system
    ;;
esac
