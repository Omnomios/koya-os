#!/bin/bash
# Run only INSIDE the disposable QEMU guest, with this tree mounted read-only.
set -euo pipefail
[[ $(cat /sys/class/dmi/id/product_name) == *QEMU* || $(cat /sys/class/dmi/id/sys_vendor) == QEMU ]] || { printf 'Requires the QEMU test guest.\n' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
[[ -b /dev/vda ]] || exit 1
disk_key=$("$root/backend/install.sh" --disks | jq -er '.[]|select(.path=="/dev/vda" and .reason=="")|.key')
{
  jq -nc --arg key "$disk_key" '{type:"install",confirmation:"/dev/vda",config:{disk:"/dev/vda",diskKey:$key,username:"koyatest",hostname:"koya-test",timezone:"Australia/Sydney",encrypt:true,apps:["firefox","files","audio","screenshots"]}}'
  printf '%s\n' '{"type":"secret","name":"account_password","value":"Koya-vm-fixture-42"}'
  printf '%s\n' '{"type":"secret","name":"luks_passphrase","value":"Koya-vm-fixture-42"}'
} | "$root/backend/install.sh" --gui
