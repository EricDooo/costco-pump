#!/usr/bin/env bash
# Rebuilds the 8 international basemap tile extracts (see
# app/scraper/international.py's COUNTRIES for the list) from Protomaps'
# daily-built planet PMTiles, and uploads them to the VM. Manual and
# occasional, same reasoning as update-tiles.sh -- not wired into CI.
#
# Needs: the go-pmtiles CLI (downloaded automatically below if not already
# on PATH), and the `costco-pump` SSH deploy key -- point
# COSTCO_PUMP_SSH_KEY at it:
#
#   COSTCO_PUMP_SSH_KEY=/path/to/costco-pump ./scripts/update-international-tiles.sh
set -euo pipefail

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

PMTILES_CLI_VERSION="1.31.2"
SSH_KEY="${COSTCO_PUMP_SSH_KEY:?Set COSTCO_PUMP_SSH_KEY to the path of the costco-pump SSH deploy key}"
VM_HOST="ubuntu@192.9.129.226"

# 1. Get the go-pmtiles CLI if it's not already on PATH.
if command -v pmtiles >/dev/null 2>&1; then
  PMTILES_BIN="pmtiles"
else
  echo "Downloading go-pmtiles CLI v${PMTILES_CLI_VERSION}..."
  case "$(uname -s)" in
    Linux) asset="Linux_x86_64.tar.gz" ;;
    Darwin) asset="Darwin_x86_64.zip" ;;
    MINGW* | MSYS* | CYGWIN*) asset="Windows_x86_64.zip" ;;
    *)
      echo "Unsupported OS: $(uname -s) -- download go-pmtiles manually from" >&2
      echo "https://github.com/protomaps/go-pmtiles/releases and set PMTILES_BIN" >&2
      exit 1
      ;;
  esac
  url="https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_CLI_VERSION}/go-pmtiles_${PMTILES_CLI_VERSION}_${asset}"
  curl -sL -o "$WORK_DIR/cli.archive" "$url"
  (cd "$WORK_DIR" && case "$asset" in
    *.zip) unzip -q cli.archive ;;
    *.tar.gz) tar xzf cli.archive ;;
  esac)
  PMTILES_BIN="$WORK_DIR/pmtiles"
  [ -f "$WORK_DIR/pmtiles.exe" ] && PMTILES_BIN="$WORK_DIR/pmtiles.exe"
fi

# 2. Find the most recent daily planet build.
PLANET_URL=""
for days_ago in 0 1 2 3; do
  date_str="$(date -u -d "-${days_ago} day" +%Y%m%d 2>/dev/null || date -u -v-"${days_ago}"d +%Y%m%d)"
  candidate="https://build.protomaps.com/${date_str}.pmtiles"
  if curl -sI --max-time 10 "$candidate" | head -1 | grep -q "200"; then
    PLANET_URL="$candidate"
    break
  fi
done
[ -n "$PLANET_URL" ] || {
  echo "Could not find a recent planet build at build.protomaps.com" >&2
  exit 1
}
echo "Using planet build: $PLANET_URL"

# 3. Extract each country -- bboxes are generous standard country extents
# (checked against real warehouse coordinates where we have them; padded
# for the countries that don't have any live data yet), not derived from
# the warehouses table the way update-tiles.sh's domestic bbox is, since
# several of these countries had zero rows when this was written (their
# international-sweep schedule hadn't reached them yet -- see
# enqueuer.py's business-hours gating). Re-derive from
# `SELECT min(lon),max(lon),min(lat),max(lat) FROM warehouses WHERE id
# BETWEEN <offset> AND <offset+9999>` (see scraper/international.py's
# COUNTRIES for offsets) if Costco's footprint in a country turns out to
# sit outside its box.
declare -A BBOX
BBOX[australia]="112,-44,154,-10"
BBOX[japan]="122,24,146,46"
BBOX[mexico]="-118,14,-86,33"
BBOX[taiwan]="119.5,21.5,122.5,25.5"
BBOX[spain]="-10,35.5,4.5,44"
BBOX[france]="-5,41,10,51.5"
BBOX[korea]="124,33,130,39"
BBOX[iceland]="-25,63,-13,67"

for country in australia japan mexico taiwan spain france korea iceland; do
  echo "Extracting $country (${BBOX[$country]}, maxzoom=10)..."
  "$PMTILES_BIN" extract "$PLANET_URL" "$WORK_DIR/${country}.pmtiles" \
    --bbox="${BBOX[$country]}" --maxzoom=10 --download-threads=8
done

# 4. Upload -- same directory update-tiles.sh's domestic.pmtiles lives in;
# Caddy's /costcogas/tiles/* route is a plain directory file_server, so any
# filename here is immediately servable with no route changes.
echo "Uploading to ${VM_HOST}..."
for country in australia japan mexico taiwan spain france korea iceland; do
  scp -i "$SSH_KEY" "$WORK_DIR/${country}.pmtiles" "${VM_HOST}:~/infra/site/costcogas-tiles/${country}.pmtiles"
done

echo "Done. No Caddy reload needed -- they're static files, served fresh next request."
