#!/bin/bash
set -euo pipefail
[[ -f /.dockerenv && -f /etc/arch-release && $EUID == 0 ]] || {
  printf 'Run this build helper as root inside the Arch Linux Docker container.\n' >&2; exit 1;
}
: "${KOYA_IMAGE_VERSION:?Set the image version before building}"
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
retry_build_step() {
  local attempt
  for attempt in 1 2 3; do
    if "$@"; then return 0; fi
    if (( attempt < 3 )); then
      printf 'Build step failed; retrying after attempt %s of 3.\n' "$attempt" >&2
      sleep 5
    fi
  done
  return 1
}
# Base images may lack a local signing key or carry an older Arch keyring.
# Initialize trust and refresh that keyring before verifying current packages.
cp payload/mirrorlist /etc/pacman.d/mirrorlist
pacman-key --init
pacman-key --populate archlinux
retry_build_step pacman -Sy --noconfirm --needed archlinux-keyring
retry_build_step pacman -Syu --noconfirm --needed archiso archlinux-keyring git gnupg jq nodejs npm tzdata
npm test
retry_build_step ./build-image.sh
bash tools/prepare-release.sh "$KOYA_IMAGE_VERSION" dist dist/release
