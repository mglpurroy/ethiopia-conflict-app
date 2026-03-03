#!/usr/bin/env bash
set -euo pipefail

# Idempotent sync script for Ethiopia source datasets.
# Default source repo can be overridden:
#   SOURCE_REPO_URL=... ./backend/scripts/sync_ethiopia_source_data.sh
# Local checkout location can be overridden:
#   SOURCE_CLONE_DIR=/tmp/ethiopia-dashboard-source ./backend/scripts/sync_ethiopia_source_data.sh

SOURCE_REPO_URL="${SOURCE_REPO_URL:-https://github.com/mglpurroy/ethiopia-dashboard.git}"
SOURCE_CLONE_DIR="${SOURCE_CLONE_DIR:-/tmp/ethiopia-dashboard-source}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST_DATA_DIR="$BACKEND_DIR/data"

echo "[sync] backend dir: $BACKEND_DIR"
echo "[sync] data dir:    $DEST_DATA_DIR"
echo "[sync] source url:  $SOURCE_REPO_URL"
echo "[sync] clone dir:   $SOURCE_CLONE_DIR"

mkdir -p "$DEST_DATA_DIR/processed"

if [[ ! -d "$SOURCE_CLONE_DIR/.git" ]]; then
  echo "[sync] cloning source repository..."
  git clone --depth 1 "$SOURCE_REPO_URL" "$SOURCE_CLONE_DIR"
else
  echo "[sync] updating existing source repository..."
  git -C "$SOURCE_CLONE_DIR" fetch --depth 1 origin
  DEFAULT_BRANCH="$(git -C "$SOURCE_CLONE_DIR" symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@')"
  git -C "$SOURCE_CLONE_DIR" checkout "$DEFAULT_BRANCH"
  git -C "$SOURCE_CLONE_DIR" pull --ff-only --depth 1 origin "$DEFAULT_BRANCH"
fi

SRC_DATA_DIR="$SOURCE_CLONE_DIR/data"

required_src=(
  "$SRC_DATA_DIR/acled_Ethiopia.csv"
  "$SRC_DATA_DIR/acled_Ethiopia_light.csv"
  "$SRC_DATA_DIR/population_data.json"
  "$SRC_DATA_DIR/processed/intersection_result_acled.csv"
  "$SRC_DATA_DIR/eth_adm_csa_bofedb_2021_shp"
)

for path in "${required_src[@]}"; do
  if [[ ! -e "$path" ]]; then
    echo "[sync] ERROR: required source path missing: $path" >&2
    exit 1
  fi
done

echo "[sync] copying mapped files..."
cp -f "$SRC_DATA_DIR/acled_Ethiopia.csv" "$DEST_DATA_DIR/acled_Ethiopia.csv"
cp -f "$SRC_DATA_DIR/acled_Ethiopia_light.csv" "$DEST_DATA_DIR/acled_Ethiopia_light.csv"
cp -f "$SRC_DATA_DIR/population_data.json" "$DEST_DATA_DIR/population_data.json"
cp -f "$SRC_DATA_DIR/processed/intersection_result_acled.csv" "$DEST_DATA_DIR/processed/intersection_result_acled.csv"

mkdir -p "$DEST_DATA_DIR/eth_adm_csa_bofedb_2021_shp"
rsync -a --delete \
  "$SRC_DATA_DIR/eth_adm_csa_bofedb_2021_shp/" \
  "$DEST_DATA_DIR/eth_adm_csa_bofedb_2021_shp/"

echo "[sync] NOTE: intentionally skipping data/eth_ppp_2020.tif for v1."

echo "[sync] completed. copied files:"
ls -lh \
  "$DEST_DATA_DIR/acled_Ethiopia.csv" \
  "$DEST_DATA_DIR/acled_Ethiopia_light.csv" \
  "$DEST_DATA_DIR/population_data.json" \
  "$DEST_DATA_DIR/processed/intersection_result_acled.csv"
echo "[sync] shapefile dir size:"
du -sh "$DEST_DATA_DIR/eth_adm_csa_bofedb_2021_shp"
