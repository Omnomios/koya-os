#!/bin/bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
export KOYA_INSTALLER_ROOT=$root
export KOYA_INSTALLER_PAYLOAD=${KOYA_INSTALLER_PAYLOAD:-$root/payload}
export KOYA_INSTALLER_PREVIEW=0
case ${1:-} in
  --preview) export KOYA_INSTALLER_PREVIEW=1; shift ;;
  '') ;;
  *) printf 'Usage: ./run.sh [--preview]\n' >&2; exit 2 ;;
esac
export KOYA_INSTALLER_SELF_TEST=0
if [[ ${1:-} == --self-test && $KOYA_INSTALLER_PREVIEW == 1 ]]; then KOYA_INSTALLER_SELF_TEST=1; shift; fi
binary=${KOYA_BIN:-koya}
assets=${KOYA_ASSET_DIR:-/usr/share/koya/assets}
[[ -f $assets/std/koya-ui.js ]] || { printf 'Koya shared assets not found.\n' >&2; exit 1; }
# Only boot/ is mounted from here; it mounts the rest (see boot/installer.js).
exec "$binary" -m "$assets" -m "$root/boot" -i installer.js "$@"
