# Global ADS-B snapshot (single run)

# Output file
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outputFile = "scripts\adsblol_aircraft-data_dump_$timestamp.json"

# Large regional coverage (tweak as needed)
$regions = @(
    "lat/40/lon/-100/dist/2500",   # North America
    "lat/-15/lon/-60/dist/2500",   # South America
    "lat/50/lon/10/dist/2500",     # Europe
    "lat/20/lon/20/dist/2500",     # Africa
    "lat/30/lon/100/dist/2500",    # Asia
    "lat/-25/lon/135/dist/2500"    # Australia
)

$allAircraft = @{}

Write-Host "Fetching global ADS-B snapshot..." -ForegroundColor Cyan

foreach ($region in $regions) {
    try {
        $url = "https://api.adsb.lol/v2/$region"
        Write-Host "Querying $region ..." -ForegroundColor DarkGray

        $response = Invoke-RestMethod -Uri $url -Method Get

        if ($response.ac) {
            foreach ($ac in $response.ac) {
                # Deduplicate by ICAO hex
                if (-not $allAircraft.ContainsKey($ac.hex)) {
                    $allAircraft[$ac.hex] = $ac
                }
            }
        }
    }
    catch {
        Write-Host "Failed region: $region" -ForegroundColor Red
    }
}

# Convert to array
$aircraftList = $allAircraft.Values

Write-Host "`n=== GLOBAL SNAPSHOT ($(Get-Date)) ===" -ForegroundColor Yellow
Write-Host "Total Aircraft: $($aircraftList.Count)`n" -ForegroundColor Green

# Full dump saved
$aircraftList | ConvertTo-Json -Depth 10 | Out-File $outputFile

# Display detailed output
#$aircraftList | ForEach-Object {
#    Write-Host "-----------------------------" -ForegroundColor DarkGray
#    $_ | Format-List *
#}