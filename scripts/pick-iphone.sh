#!/bin/bash
# Lists paired physical iPhones and prints the chosen one's UDID on stdout.
# Prompts go to stderr so the Makefile can capture just the UDID.
# Picks automatically when only one phone is available.
set -euo pipefail

tmp=$(mktemp -t devices).json
trap 'rm -f "$tmp"' EXIT
xcrun devicectl list devices --json-output "$tmp" >/dev/null 2>&1

# One line per phone: udid<TAB>name<TAB>model<TAB>iOS<TAB>connection
list=$(python3 -I - "$tmp" <<'PY'
import json, sys
for d in json.load(open(sys.argv[1]))["result"]["devices"]:
    hw, dp, cp = d["hardwareProperties"], d["deviceProperties"], d["connectionProperties"]
    if hw.get("reality") != "physical" or hw.get("deviceType") != "iPhone":
        continue
    if cp.get("pairingState") != "paired":
        continue
    link = "USB" if cp.get("transportType") == "wired" else "Wi-Fi"
    print("\t".join([hw["udid"], dp.get("name", "").strip(), hw.get("marketingName", ""),
                     dp.get("osVersionNumber", "?"), link]))
PY
)

if [ -z "$list" ]; then
  echo "No paired iPhone found. Connect one by cable, unlock it and tap Trust." >&2
  exit 1
fi

count=$(printf '%s\n' "$list" | wc -l | tr -d ' ')
if [ "$count" -eq 1 ]; then
  choice=1
else
  echo "Which iPhone?" >&2
  i=1
  while IFS=$'\t' read -r udid name model os link; do
    printf '  %d) %s — %s, iOS %s, %s\n' "$i" "$name" "$model" "$os" "$link" >&2
    i=$((i + 1))
  done <<< "$list"
  printf 'Enter 1-%d: ' "$count" >&2
  read -r choice < /dev/tty
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt "$count" ]; then
    echo "Invalid choice." >&2
    exit 1
  fi
fi

line=$(printf '%s\n' "$list" | sed -n "${choice}p")
IFS=$'\t' read -r udid name model os link <<< "$line"
echo "Using $name ($model, $link)" >&2
echo "$udid"
