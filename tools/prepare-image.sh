#!/bin/bash
set -euo pipefail
umask 022
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
work=$(realpath -- "${1:?Build directory required}")
version=${2:?Image version required}
[[ ! -e $work/profile ]] || { printf 'Use a fresh build directory.\n' >&2; exit 1; }
for tool in gpg tar sha256sum jq; do command -v "$tool" >/dev/null; done
(cd "$root/payload" && sha256sum --check --quiet SHA256SUMS)
mkdir -m 700 "$work/verify"
fingerprint=$(gpg --batch --no-autostart --homedir "$work/verify" --show-keys --with-colons "$root/payload/koya-packages.pub" 2>/dev/null | awk -F: '$1 == "fpr" {print $10; exit}')
[[ $fingerprint == 06089A97B6D66C69BFD021F0DF7B60698EF57FF3 ]] || { printf 'Unexpected Koya signing key.\n' >&2; exit 1; }
gpg --batch --no-autostart --homedir "$work/verify" --import "$root/payload/koya-packages.pub"
cp -a "$root/image" "$work/profile"
profile=$work/profile live=$work/profile/airootfs app=$work/profile/airootfs/opt/koya-installer
mkdir -p "$app" "$live/etc/pacman.d" "$profile/efiboot/loader/entries"
# Explicit bundle contents keep local builds, logs, Git data and VM images out.
cp -a "$root/apps" "$root/assets" "$root/backend" "$root/payload" "$app/"
cp -a "$root/boot" "$app/"
cp "$root/run.sh" "$root/install.sh" "$root/LICENSE" "$root/NOTICE" "$app/"
printf '%s\n' "$version" > "$app/IMAGE_VERSION"
printf '%s\n' "$version" > "$live/etc/koya-live"
# Include the same desktop and optional apps offered by the installer, plus
# the live image's installation tools. Keep the target package list separate.
{
  cat "$root/image/packages.x86_64" "$root/payload/packages.txt"
  jq -r '.[].packages[]' "$root/backend/optional-apps.json"
} | sed -E '/^[[:space:]]*(#|$)/d' | sort -u > "$profile/packages.x86_64"
# useradd copies this profile when the live account is created at boot.
mkdir -p "$live/etc/skel/.config" "$live/etc/skel/.local/share/koya-bar/wallpapers"
cp -a "$root/payload/profile/config/." "$live/etc/skel/.config/"
cp -a "$root/payload/profile/wallpapers/." "$live/etc/skel/.local/share/koya-bar/wallpapers/"
# Avoid idle locking while someone is trying the live desktop or installing it.
sed -i '\|hl.exec_cmd("hypridle")|d' "$live/etc/skel/.config/hypr/hyprland.lua"
printf '\ndofile(os.getenv("HOME") .. "/.config/hypr/live.lua")\n' >> "$live/etc/skel/.config/hypr/hyprland.lua"
cp "$root/payload/mirrorlist" "$live/etc/pacman.d/mirrorlist"
sed "s|@MIRRORLIST@|$root/payload/mirrorlist|; /Architecture = auto/a GPGDir = $work/keyring" "$root/payload/pacman.conf.in" > "$profile/pacman.conf"
cat "$root/payload/koya-repository.conf" >> "$profile/pacman.conf"
# The running image uses ordinary Arch mirrors, never the build machine's paths.
sed 's|@MIRRORLIST@|/etc/pacman.d/mirrorlist|' "$root/payload/pacman.conf.in" > "$live/etc/pacman.conf"
cat "$root/payload/koya-repository.conf" >> "$live/etc/pacman.conf"
sed -i "s|@VERSION@|$version|g" "$profile/profiledef.sh"
units=$live/etc/systemd/system
mkdir -p "$units/multi-user.target.wants"
ln -s /usr/lib/systemd/system/greetd.service "$units/display-manager.service"
for unit in NetworkManager systemd-resolved systemd-timesyncd ModemManager bluetooth; do
  ln -s "/usr/lib/systemd/system/$unit.service" "$units/multi-user.target.wants/$unit.service"
done
userunits=$live/etc/systemd/user
mkdir -p "$userunits/sockets.target.wants" "$userunits/pipewire.service.wants"
for unit in pipewire pipewire-pulse ssh-agent; do
  ln -s "/usr/lib/systemd/user/$unit.socket" "$userunits/sockets.target.wants/$unit.socket"
done
ln -s /usr/lib/systemd/user/wireplumber.service "$userunits/pipewire.service.wants/wireplumber.service"
ln -s /usr/lib/systemd/system/graphical.target "$units/default.target"
ln -s /dev/null "$units/getty@tty1.service"
ln -s /run/systemd/resolve/stub-resolv.conf "$live/etc/resolv.conf"
ln -s /usr/share/zoneinfo/UTC "$live/etc/localtime"
# Archiso explicitly applies executable modes after copying the root overlay.
for file in /usr/local/bin/koya-live-session /usr/local/bin/koya-installer /usr/local/libexec/koya-live-setup; do
  chmod 755 "$live$file"
  printf 'file_permissions["%s"]="0:0:755"\n' "$file" >> "$profile/profiledef.sh"
done
chmod 440 "$live/etc/sudoers.d/10-koya-live"
printf 'file_permissions["/etc/sudoers.d/10-koya-live"]="0:0:440"\n' >> "$profile/profiledef.sh"
while IFS= read -r -d '' file; do
  printf 'file_permissions["%s"]="0:0:755"\n' "${file#"$live"}" >> "$profile/profiledef.sh"
done < <(find "$app" -type f -name '*.sh' -print0)
