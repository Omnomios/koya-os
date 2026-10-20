#!/bin/bash
storage_step() {
  stage partition 'Partitioning the selected disk'
  sgdisk --zap-all "$disk"
  local root_type=8300
  $encrypt && root_type=8309
  sgdisk --clear --new=1:2048:+512M --typecode=1:ef00 --change-name=1:EFI --new=2:0:0 --typecode=2:"$root_type" --change-name=2:KoyaRoot "$disk"
  partprobe "$disk"; udevadm settle
  [[ -b $efi && -b $rootpart ]] || die 'New partitions did not appear'
  mkfs.fat -F32 -n EFI "$efi"
  root_device=$rootpart
  if $encrypt; then
    stage encrypt 'Encrypting the root filesystem'
    if $gui; then
      cryptsetup luksFormat --batch-mode --type luks2 --key-file /dev/fd/4 "$rootpart" 4< <(printf '%s' "$luks_passphrase")
      cryptsetup open --key-file /dev/fd/4 "$rootpart" "$mapper" 4< <(printf '%s' "$luks_passphrase")
      unset luks_passphrase
    else
      cryptsetup luksFormat --type luks2 "$rootpart"
      cryptsetup open "$rootpart" "$mapper"
    fi
    mapped=true
    root_device=/dev/mapper/$mapper
  fi
  stage format 'Formatting and mounting the filesystems'
  mkfs.ext4 -F -L ROOT "$root_device" || die "Could not format root filesystem on $root_device"
  mkdir -p "$mnt" || die 'Could not create the root mount directory'
  mount "$root_device" "$mnt" || die "Could not mount root filesystem from $root_device"
  root_mounted=true
  mkdir -p "$mnt/boot" || die 'Could not create the EFI mount directory'
  mount "$efi" "$mnt/boot" || die "Could not mount EFI filesystem from $efi"
  efi_mounted=true
}
