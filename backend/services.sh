#!/bin/bash
services_step() {
  stage services 'Configuring networking, sound and boot services'
  systemctl --root="$mnt" enable NetworkManager.service systemd-resolved.service systemd-timesyncd.service ModemManager.service bluetooth.service
  systemctl --root="$mnt" --global enable ssh-agent.socket pipewire.socket pipewire-pulse.socket
  ln -sf /run/systemd/resolve/stub-resolv.conf "$mnt/etc/resolv.conf"
  local efiuuid
  rootuuid=$(blkid -s UUID -o value "$root_device"); efiuuid=$(blkid -s UUID -o value "$efi")
  printf 'UUID=%s / ext4 defaults 0 1\nUUID=%s /boot vfat defaults 0 2\n' "$rootuuid" "$efiuuid" > "$mnt/etc/fstab"
  if $encrypt; then
    cryptuuid=$(blkid -s UUID -o value "$rootpart")
    printf 'cryptroot UUID=%s none luks\n' "$cryptuuid" > "$mnt/etc/crypttab"
  else
    : > "$mnt/etc/crypttab"
  fi
}
