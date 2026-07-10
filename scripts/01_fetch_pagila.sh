#!/usr/bin/env bash
set -euo pipefail
mkdir -p db/vendor
curl -fsSL -o db/vendor/pagila-schema.sql \
  https://raw.githubusercontent.com/devrimgunduz/pagila/master/pagila-schema.sql
curl -fsSL -o db/vendor/pagila-data.sql \
  https://raw.githubusercontent.com/devrimgunduz/pagila/master/pagila-data.sql
wc -l db/vendor/pagila-schema.sql db/vendor/pagila-data.sql
