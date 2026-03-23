# OpenSky API endpoint
$url = "https://opensky-network.org/api/states/all"

# Output file
$outputFile = "scripts\outputs\opensky_basic_api_data.json"

try {
    Write-Host "Requesting data from OpenSky API..."

    $response = Invoke-RestMethod -Uri $url -Method Get

    $mappedStates = @()

    foreach ($state in $response.states) {
        $mappedStates += [PSCustomObject]@{
            icao24           = $state[0]
            callsign         = $state[1]
            origin_country   = $state[2]
            time_position    = $state[3]
            last_contact     = $state[4]
            longitude        = $state[5]
            latitude         = $state[6]
            baro_altitude    = $state[7]
            on_ground        = $state[8]
            velocity         = $state[9]
            true_track       = $state[10]
            vertical_rate    = $state[11]
            sensors          = $state[12]
            geo_altitude     = $state[13]
            squawk           = $state[14]
            spi              = $state[15]
            position_source  = $state[16]
            category         = $state[17]
        }
    }

    # Wrap with timestamp
    $output = [PSCustomObject]@{
        time   = $response.time
        states = $mappedStates
    }

    # Save to file
    $output | ConvertTo-Json -Depth 10 | Out-File -FilePath $outputFile -Encoding utf8

    Write-Host "Mapped data saved to $outputFile"
}
catch {
    Write-Host "Error occurred:"
    Write-Host $_
}