#!/bin/bash
packages_step() {
  stage packages 'Preparing package signing keys'
  # pacstrap -K initialises the target keyring, but its download verification
  # uses the live system's keyring. The image build keyring is not shipped.
  pacman-key --init
  pacman-key --populate archlinux
  pacman-key --add "$payload/koya-packages.pub"
  pacman-key --lsign-key 06089A97B6D66C69BFD021F0DF7B60698EF57FF3
  stage packages 'Installing Arch Linux and desktop packages'
  local packages
  mapfile -t packages < <(sed -E '/^[[:space:]]*(#|$)/d' "$payload/packages.txt")
  local chosen
  mapfile -t chosen < <(jq -r --argjson selected "$apps" '.[] | select(.id as $id | $selected | index($id)) | .packages[]' "$root/backend/optional-apps.json")
  packages+=("${chosen[@]}")
  sed "s|@MIRRORLIST@|$payload/mirrorlist|" "$payload/pacman.conf.in" > "$work/pacman.conf"
  cat "$payload/koya-repository.conf" >> "$work/pacman.conf"
  # The live image has a temporary overlay. Keep downloads on the destination
  # disk using pacstrap's default target cache, rather than consuming live RAM.
  pacstrap -K -M -C "$work/pacman.conf" "$mnt" "${packages[@]}"
  install -m 644 "$payload/mirrorlist" "$mnt/etc/pacman.d/mirrorlist"
  sed 's|@MIRRORLIST@|/etc/pacman.d/mirrorlist|' "$payload/pacman.conf.in" > "$mnt/etc/pacman.conf"
  cat "$payload/koya-repository.conf" >> "$mnt/etc/pacman.conf"
  stage runtime 'Installing Koya Shell'
  install -d -m 755 "$mnt/var/lib/koya-installer"
  install -m 644 "$payload/koya-packages.pub" "$mnt/var/lib/koya-installer/koya-packages.pub"
  arch-chroot "$mnt" pacman-key --add /var/lib/koya-installer/koya-packages.pub
  arch-chroot "$mnt" pacman-key --lsign-key 06089A97B6D66C69BFD021F0DF7B60698EF57FF3
  arch-chroot "$mnt" pacman -Syu --noconfirm --needed koya/koya-shell
  arch-chroot "$mnt" pacman -Q koya koya-shell helix-plugins framework-dbus > "$mnt/var/lib/koya-installer/desktop-packages"
}
