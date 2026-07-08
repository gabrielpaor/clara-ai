# Imports and publishes all Clara workflows into the running n8n container.
# Usage (from repo root): .\scripts\import-workflows.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Get-ChildItem n8n\workflows\*.json | ForEach-Object {
    docker compose cp $_.FullName "n8n:/tmp/$($_.Name)"
    docker compose exec -T n8n n8n import:workflow --input="/tmp/$($_.Name)"
}

# Workflow ids are pinned in the JSON files
foreach ($id in @("ClaraInvoiceExtr", "ClaraEmailIngest", "ClaraNotify00001", "ClaraErrorHandlr", "ClaraMaintenance", "ClaraBatchDisp01")) {
    docker compose exec -T n8n n8n publish:workflow --id=$id
}

docker compose exec -T -u root n8n sh -c 'rm -f /tmp/*.json'
# CLI changes only take effect after a restart
docker compose restart n8n
Write-Host "All workflows imported and published. n8n restarting."
