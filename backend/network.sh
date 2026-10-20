#!/bin/bash
set -uo pipefail
arch=false koya=false
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
payload=${KOYA_INSTALLER_PAYLOAD:-$root/payload}
while read -r key equals server; do
  [[ $key == Server ]] || continue
  url=${server//\$repo/core}; url=${url//\$arch/x86_64}
  if curl -fsIL --connect-timeout 8 --max-time 12 "$url/core.db" >/dev/null 2>&1; then arch=true; break; fi
done < "$payload/mirrorlist"
curl -fsIL --connect-timeout 8 --max-time 12 https://www.koya-ui.com/repository/x86_64/koya.db >/dev/null 2>&1 && koya=true
printf '{"arch":%s,"koya":%s,"online":%s}\n' "$arch" "$koya" "$($arch && $koya && printf true || printf false)"
$arch && $koya
