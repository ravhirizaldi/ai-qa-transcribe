#!/usr/bin/env sh
set -eu

cd /app
exec node /app/backend/dist/src/server.js
