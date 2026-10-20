#!/bin/bash
account_step() {
  stage account 'Creating your account'
  ln -sf "/usr/share/zoneinfo/$timezone" "$mnt/etc/localtime"
  printf '%s\n' "$hostname" > "$mnt/etc/hostname"
  printf 'LANG=C.UTF-8\n' > "$mnt/etc/locale.conf"
  printf 'KEYMAP=us\n' > "$mnt/etc/vconsole.conf"
  printf '127.0.0.1 localhost\n::1 localhost\n127.0.1.1 %s\n' "$hostname" > "$mnt/etc/hosts"
  arch-chroot "$mnt" useradd --create-home --user-group --shell /bin/bash --groups wheel,video,input,uucp "$username"
  if $gui; then printf '%s:%s\n' "$username" "$account_password" | arch-chroot "$mnt" chpasswd; unset account_password
  else arch-chroot "$mnt" passwd "$username"; fi
  arch-chroot "$mnt" passwd --lock root
  printf '%%wheel ALL=(ALL:ALL) ALL\n' > "$mnt/etc/sudoers.d/10-wheel"
  chmod 440 "$mnt/etc/sudoers.d/10-wheel"
  arch-chroot "$mnt" visudo --check
}
