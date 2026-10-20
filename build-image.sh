#!/bin/bash
set -euo pipefail
umask 022
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
prepare=false
case ${1:-} in
  --prepare-only) prepare=true; shift ;;
  --help|-h) printf 'Usage: ./build-image.sh [--prepare-only] [OUTPUT_DIRECTORY]\n'; exit ;;
esac
(( $# <= 1 )) || { printf 'Expected one output directory.\n' >&2; exit 1; }
if ! $prepare; then
  (( EUID == 0 )) || { printf 'Run the image build as root. Preview and --prepare-only work as a normal user.\n' >&2; exit 1; }
  command -v mkarchiso >/dev/null || { printf 'Install archiso and archlinux-keyring with pacman first.\n' >&2; exit 1; }
fi
output=$(realpath -m -- "${1:-$root/dist}")
[[ $root != *[[:space:]]* && $output != *[[:space:]]* ]] || { printf 'Build paths must not contain whitespace (pacman repository paths).\n' >&2; exit 1; }
mkdir -p "$root/.work" "$output"
work=$(mktemp -d "$root/.work/image.XXXXXX")
version=${KOYA_IMAGE_VERSION:-$(date -u +%Y.%m.%d-%H%M%S)}
[[ $version =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$ ]] || { printf 'Invalid KOYA_IMAGE_VERSION.\n' >&2; exit 1; }
image=koya-installer-$version-x86_64.iso
[[ ! -e $output/$image ]] || { printf 'Image already exists: %s\n' "$output/$image" >&2; exit 1; }
"$root/tools/prepare-image.sh" "$work" "$version"
printf 'Prepared image profile: %s/profile\n' "$work"
if $prepare; then exit; fi
# Trust the bundled signing key in a build-local keyring; leave the host's
# pacman configuration and keyring alone.
trap 'gpgconf --homedir "$work/keyring" --kill gpg-agent || true' EXIT
pacman-key --gpgdir "$work/keyring" --init
pacman-key --gpgdir "$work/keyring" --populate archlinux
pacman-key --gpgdir "$work/keyring" --add "$root/payload/koya-packages.pub"
pacman-key --gpgdir "$work/keyring" --lsign-key 06089A97B6D66C69BFD021F0DF7B60698EF57FF3
mkarchiso -v -m iso -w "$work/build" -o "$output" "$work/profile"
[[ -s $output/$image ]] || { printf 'Archiso did not produce the expected image.\n' >&2; exit 1; }
(cd "$output" && sha256sum "$image" > "$image.sha256")
cp "$work/build/iso/koya/pkglist.x86_64.txt" "$output/$image.packages.txt"
printf '\nImage: %s/%s\nChecksum: %s/%s.sha256\nBuild files: %s\n' "$output" "$image" "$output" "$image" "$work"
