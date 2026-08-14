#!/usr/bin/env sh
# Spark fleet health check — exit 0 when /api/ci spark_ok is true.
# Wrapper around the Node script so Unix CI can call a single file.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ORIGIN=${FIROSTATUS_ORIGIN:-https://firostatus.com}
export FIROSTATUS_ORIGIN="$ORIGIN"
exec node "$ROOT/scripts/spark-health-check.js" "$@"
