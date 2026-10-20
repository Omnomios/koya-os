#!/bin/bash
# Read-only inventory shared by the picker, review and final write guard.
inventory() {
  local source_device boot_uuid
  # Archiso runs the application from an overlay. Its physical boot medium is
  # mounted separately, so identify that device before falling back to payload.
  source_device=$(findmnt -nro MAJ:MIN --mountpoint /run/archiso/bootmnt 2>/dev/null || findmnt -nro MAJ:MIN --target "$payload") || return
  # Keep protecting the source even if a custom boot copies the live system
  # into RAM and unmounts its USB. Archiso records its ISO UUID in the cmdline.
  boot_uuid=$(tr ' ' '\n' < /proc/cmdline | sed -n 's/^archisosearchuuid=//p' | head -n 1)
  lsblk --json --bytes -o PATH,TYPE,SIZE,MODEL,SERIAL,TRAN,RO,MOUNTPOINTS,MAJ:MIN,UUID | jq --arg source "$source_device" --arg boot_uuid "$boot_uuid" '
    [.blockdevices[] | select(.type == "disk") |
      . as $disk | [.. | objects | select(has("path"))] as $tree |
      {path, size, model: ((.model // "Disk") | rtrimstr(" ")), serial: (.serial // ""), transport: (.tran // ""),
       key: ([.["maj:min"], (.size|tostring), (.serial // ""), (.model // "")] | join("|")),
       reason: (if any($tree[]; .["maj:min"] == $source or ($boot_uuid != "" and .uuid == $boot_uuid)) then "Contains the installer"
         elif any($tree[]; (.mountpoints // []) | any(. != null and . != "")) then "Mounted or in use as swap"
         elif any($tree[]; .type != "disk" and .type != "part") then "Has an open device mapping"
         elif .ro then "Read-only disk"
         elif .size < 21474836480 then "Requires at least 20 GiB"
         else "" end)}]'
}
validate_disk() {
  local entry
  [[ $disk == /dev/* && -b $disk && ! -L $disk ]] || die 'Select a whole disk using its canonical device path'
  entry=$(inventory | jq -ce --arg path "$disk" '.[] | select(.path == $path)') || die 'The selected disk is no longer available'
  [[ $(jq -r .reason <<< "$entry") == '' ]] || die "$(jq -r .reason <<< "$entry")"
  [[ -z $disk_key || $(jq -r .key <<< "$entry") == "$disk_key" ]] || die 'The selected disk changed; select and review it again'
  disk_key=$(jq -r .key <<< "$entry")
  if [[ $disk =~ [0-9]$ ]]; then efi=${disk}p1; rootpart=${disk}p2; else efi=${disk}1; rootpart=${disk}2; fi
}
