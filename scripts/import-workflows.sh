#!/usr/bin/env bash
# Imports and publishes all Clara workflows into the running n8n container.
# Usage (from repo root): ./scripts/import-workflows.sh
set -euo pipefail
cd "$(dirname "$0")/.."

for f in n8n/workflows/*.json; do
  name=$(basename "$f")
  docker compose cp "$f" "n8n:/tmp/$name"
  docker compose exec -T n8n n8n import:workflow --input="/tmp/$name"
done

# Workflow ids are pinned in the JSON files
for id in ClaraInvoiceExtr ClaraEmailIngest ClaraNotify00001 ClaraErrorHandlr ClaraMaintenance; do
  docker compose exec -T n8n n8n publish:workflow --id="$id"
done

docker compose exec -T -u root n8n sh -c 'rm -f /tmp/*.json'
# CLI changes only take effect after a restart
docker compose restart n8n
echo "All workflows imported and published. n8n restarting."
