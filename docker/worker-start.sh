#!/usr/bin/env sh
set -eu

cd /app
exec node /app/worker/dist/worker.js
