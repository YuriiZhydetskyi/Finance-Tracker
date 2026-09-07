param(
  [string]$PostgresBin = 'C:/Program Files/PostgreSQL/17/bin',
  [switch]$GenerateTypes,
  [switch]$VerifyBackfill
)

$ErrorActionPreference = 'Stop'
$env:PGCLIENTENCODING = 'UTF8'
$repoPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$runPath = Join-Path ([System.IO.Path]::GetTempPath()) ('finance-taxonomy-pg-' + [guid]::NewGuid().ToString('N'))
$dataPath = Join-Path $runPath 'data'
New-Item -ItemType Directory -Path $runPath | Out-Null

# Ask Windows for a free loopback port; never connect to an existing database.
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
$databaseUrl = "postgresql://postgres@127.0.0.1:$port/postgres?sslmode=disable"
$started = $false

function Invoke-Pg([string]$Tool, [string[]]$Arguments) {
  & (Join-Path $PostgresBin $Tool) @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Tool failed with exit code $LASTEXITCODE" }
}

try {
  Invoke-Pg 'initdb.exe' @('-D', $dataPath, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale-provider=builtin', '--builtin-locale=C.UTF-8')
  Invoke-Pg 'pg_ctl.exe' @('-D', $dataPath, '-l', (Join-Path $runPath 'postgres.log'), '-o', "-h 127.0.0.1 -p $port", '-w', 'start')
  $started = $true
  Invoke-Pg 'psql.exe' @($databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-f', (Join-Path $PSScriptRoot 'local-bootstrap.sql'))

  # Only the taxonomy dependency slice runs here. Background imports depend on
  # managed Supabase services; this harness does not claim full-stack coverage.
  $baseMigrations = @(
    '20260507000001_initial_schema.sql',
    '20260507000003_stats_views.sql',
    '20260508000001_seed_categories.sql',
    '20260508000002_app_users_allowlist_read.sql',
    '20260508000003_add_pfand_category.sql',
    '20260508000004_categories_insert_for_allowlist.sql',
    '20260510000001_product_codes_and_prices.sql',
    '20260513000001_stats_savings_view.sql',
    '20260517000001_add_store_address_and_time.sql',
    '20260518000001_receipts_store_date_index.sql',
    '20260518000002_waste_tracking.sql',
    '20260531000001_add_manual_json_source.sql',
    '20260606000001_add_statement_source.sql',
    '20260905130900_add_amazon_order_metadata.sql',
    '20260906092959_add_amazon_categories.sql',
    '20260907073858_add_intimate_products_category.sql'
  )
  foreach ($migration in $baseMigrations) {
    Invoke-Pg 'psql.exe' @($databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-f', (Join-Path $repoPath "supabase/migrations/$migration"))
  }
  $migration = Join-Path $repoPath 'supabase/migrations/20260907154353_multilingual_product_taxonomy.sql'
  Invoke-Pg 'psql.exe' @($databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-f', $migration)
  Invoke-Pg 'psql.exe' @($databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-f', (Join-Path $repoPath 'supabase/tests/product_taxonomy.test.sql'))
  if ($GenerateTypes) {
    & node (Join-Path $PSScriptRoot 'generate-local-types.mjs') $databaseUrl
    if ($LASTEXITCODE -ne 0) { throw 'Schema type generation failed' }
  }
  if ($VerifyBackfill) {
    & node (Join-Path $PSScriptRoot 'verify-backfill.mjs') $databaseUrl
    if ($LASTEXITCODE -ne 0) { throw 'Backfill integration verification failed' }
  }
  Write-Output 'Taxonomy migration and SQL integration assertions passed on disposable PostgreSQL.'
}
finally {
  if ($started) { Invoke-Pg 'pg_ctl.exe' @('-D', $dataPath, '-m', 'fast', '-w', 'stop') }
  Write-Output "Disposable database files retained for diagnostics: $runPath"
}
