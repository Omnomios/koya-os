#!/bin/bash
set -euo pipefail
version=${1:?Image version required}
[[ $version =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$ ]] || { printf 'Invalid image version.\n' >&2; exit 1; }
source_dir=$(realpath -- "${2:-dist}")
release_dir=$(realpath -m -- "${3:-$source_dir/release}")
[[ ! -e $release_dir ]] || { printf 'Use a fresh release directory.\n' >&2; exit 1; }
image=koya-installer-$version-x86_64.iso
for file in "$image" "$image.sha256" "$image.packages.txt"; do
  [[ -s $source_dir/$file ]] || { printf 'Missing image output: %s\n' "$file" >&2; exit 1; }
done
(cd "$source_dir" && sha256sum --check -- "$image.sha256")
# Release assets must be below 2 GiB. Tests use a smaller part size to cover
# this path without allocating multi-gigabyte fixtures.
part_bytes=${KOYA_RELEASE_PART_BYTES:-2147483647}
[[ $part_bytes =~ ^[1-9][0-9]{0,9}$ ]] && (( part_bytes < 2147483648 )) || {
  printf 'Release part size must be between 1 byte and 2 GiB minus 1 byte.\n' >&2; exit 1;
}
mkdir -p "$release_dir"
cp -- "$source_dir/$image.sha256" "$source_dir/$image.packages.txt" "$release_dir/"
if (( $(stat -c %s -- "$source_dir/$image") > part_bytes )); then
  split --bytes="$part_bytes" --numeric-suffixes=1 --suffix-length=3 \
    --additional-suffix=.part -- "$source_dir/$image" "$release_dir/$image."
  cat > "$release_dir/README.txt" <<EOF
Koya Live $version

Download every numbered .part file, the .iso.sha256 file and SHA256SUMS into
one directory. The ISO is split to fit GitHub's release asset size limit.
On Linux, verify the downloads and join them before writing to USB:

    sha256sum --check SHA256SUMS --ignore-missing
    cat $image.*.part > $image
    sha256sum --check $image.sha256

The reassembled .iso is the bootable image. Write it to a USB using an image
writer, then boot an x86_64 UEFI computer. Internet is required to install.
EOF
else
  cp -- "$source_dir/$image" "$release_dir/"
  cat > "$release_dir/README.txt" <<EOF
Koya Live $version

Download the .iso and .iso.sha256 files into one directory. On Linux, verify:

    sha256sum --check $image.sha256

Write the .iso to a USB using an image writer, then boot an x86_64 UEFI
computer. Internet is required to install.
EOF
fi
cat >> "$release_dir/README.txt" <<'EOF'

The image boots into the Koya live desktop and opens the installer.
Choose Install to begin, or Try it out to explore the desktop.
The temporary live account and its password are both "live".

The .packages.txt file lists the packages included in this image.
This build passed automated checks; it has not been automatically boot-tested.
EOF
(cd "$release_dir" && sha256sum -- * > SHA256SUMS)
printf 'Prepared release files: %s\n' "$release_dir"
