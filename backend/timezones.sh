#!/bin/bash
# Timezones for the installer's picker, as one JSON array:
#   [{ "zone": "Australia/Sydney", "country": "Australia",
#      "comment": "New South Wales (most areas)", "offset": "+1100" }, ...]
# From the system's own tables (zone1970.tab, iso3166.tab), so only zones the
# installed system can use are offered. Offsets are as of now.
set -euo pipefail
zi=${KOYA_ZONEINFO:-/usr/share/zoneinfo}
declare -A country
while IFS=$'\t' read -r code name; do
  [[ -z $code || $code == \#* ]] && continue
  country[$code]=$name
done < "$zi/iso3166.tab"
while IFS=$'\t' read -r codes _ zone comment; do
  [[ -z $codes || $codes == \#* ]] && continue
  [[ -f $zi/$zone ]] || continue
  names=''
  IFS=, read -ra list <<< "$codes"
  for code in "${list[@]}"; do names+=${names:+, }${country[$code]:-$code}; done
  printf '%s\t%s\t%s\t%s\n' "$zone" "$names" "${comment:-}" "$(TZ=$zone date +%z)"
done < "$zi/zone1970.tab" |
  jq -Rsc 'split("\n") | map(select(length > 0) | split("\t") | {zone: .[0], country: .[1], comment: .[2], offset: .[3]})
    + [{zone: "UTC", country: "", comment: "Coordinated Universal Time", offset: "+0000"}]'
