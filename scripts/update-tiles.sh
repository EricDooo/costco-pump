#!/usr/bin/env bash
# Rebuilds the self-hosted domestic (US/Canada/UK) basemap tile extract from
# Protomaps' daily-built planet PMTiles, and uploads it to the VM. Manual
# and occasional -- OSM data/Costco's own footprint both change slowly, so
# this isn't wired into any CI pipeline; a stale-by-a-few-months basemap is
# a non-issue, a broken automated upload of a ~1GB file on every push would
# not be.
#
# Needs: the go-pmtiles CLI (downloaded automatically below if not already
# on PATH), and the `costco-pump` SSH deploy key -- point
# COSTCO_PUMP_SSH_KEY at it (see SSH/deploy-keys/ alongside this project, or
# wherever you keep it):
#
#   COSTCO_PUMP_SSH_KEY=/path/to/costco-pump ./scripts/update-tiles.sh
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

# 2. Find the most recent daily planet build -- there's no stable "latest"
# alias, just one file per UTC date (see docs.protomaps.com/basemaps/downloads),
# so try today back through a few prior days in case today's hasn't
# published yet.
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

# 3. Extract the domestic (US/Canada/UK) region -- bbox padded a bit past
# the warehouses table's actual min/max lat/lon (Hawaii/Alaska in the west,
# the UK in the east; re-check via `SELECT min(lon), max(lon), min(lat),
# max(lat) FROM warehouses WHERE id < 900000` if Costco's footprint moves).
# maxzoom=10 is plenty for a national/city-level reference map with pins,
# not street navigation -- each extra zoom level roughly doubles the file
# size (pmtiles.js only ever fetches small byte ranges per visible tile
# regardless of the archive's total size, so this is a hosting-cost/build-
# time tradeoff, not a per-visitor one).
echo "Extracting domestic region (maxzoom=10)..."
"$PMTILES_BIN" extract "$PLANET_URL" "$WORK_DIR/domestic.pmtiles" \
  --bbox=-160,17,1,66 --maxzoom=10 --download-threads=8

# 4. Upload to the VM, alongside (not inside) the SPA's own directory -- see
# ericdoo-infra's Caddyfile for why that separation matters.
echo "Uploading to ${VM_HOST}..."
scp -i "$SSH_KEY" "$WORK_DIR/domestic.pmtiles" "${VM_HOST}:~/infra/site/costcogas-tiles/domestic.pmtiles"

echo "Done. No Caddy reload needed -- it's a static file, served fresh next request."
