#!/bin/bash
boot_step() {
  stage boot 'Installing the bootloader and boot image'
  local hooks='base udev autodetect microcode modconf kms plymouth keyboard keymap consolefont block'
  if $encrypt; then hooks+=' encrypt'; fi
  hooks+=' filesystems fsck'
  sed -i "s/^HOOKS=.*/HOOKS=($hooks)/" "$mnt/etc/mkinitcpio.conf"
  arch-chroot "$mnt" plymouth-set-default-theme spinner
  arch-chroot "$mnt" mkinitcpio -P
  arch-chroot "$mnt" bootctl --esp-path=/boot --no-variables install
  install -d "$mnt/boot/loader/entries"
  local options="root=UUID=$rootuuid rw quiet splash rd.systemd.show_status=false"
  if $encrypt; then options="cryptdevice=UUID=$cryptuuid:cryptroot $options"; fi
  printf 'title Koya Shell Distro\nlinux /vmlinuz-linux\ninitrd /initramfs-linux.img\noptions %s\n' "$options" > "$mnt/boot/loader/entries/koya.conf"
  printf 'default koya.conf\ntimeout 0\nconsole-mode max\n' > "$mnt/boot/loader/loader.conf"
}
