# ==============================
# Aviationstack API PowerShell Script
# ==============================

# API key (replace with your actual key)
$API_KEY = "dccc996889543b7754bf151cd132cf88"

# Base URL (free tier may require HTTP instead of HTTPS)
$BASE_URL = "http://api.aviationstack.com/v1/flights"

# Optional filters (leave empty if not needed)
$params = @{
    access_key = $API_KEY
    # airline_iata = "AA"     # Example: American Airlines
    # flight_iata  = "AA100"  # Specific flight
    # dep_iata     = "JFK"    # Departure airport
    # arr_iata     = "LAX"    # Arrival airport
    limit        = 100        # Number of results
}

# Build query string
$queryString = ($params.GetEnumerator() | ForEach-Object {
    "$($_.Key)=$($_.Value)"
}) -join "&"

$url = "$BASE_URL`?$queryString"

Write-Host "Requesting data from Aviationstack..."
Write-Host $url
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri $url -Method Get

    if ($response.data) {
        foreach ($flight in $response.data) {
            Write-Host "==============================="
            Write-Host "Flight: $($flight.flight.iata)"
            Write-Host "Airline: $($flight.airline.name)"
            Write-Host "Aircraft: $($flight.aircraft.registration) ($($flight.aircraft.icao))"
            Write-Host "From: $($flight.departure.airport) [$($flight.departure.iata)]"
            Write-Host "To: $($flight.arrival.airport) [$($flight.arrival.iata)]"
            Write-Host "Status: $($flight.flight_status)"

            if ($flight.live) {
                Write-Host "--- Live Data ---"
                Write-Host "Latitude: $($flight.live.latitude)"
                Write-Host "Longitude: $($flight.live.longitude)"
                Write-Host "Altitude: $($flight.live.altitude)"
                Write-Host "Speed: $($flight.live.speed_horizontal)"
                Write-Host "Heading: $($flight.live.direction)"
                Write-Host "Updated: $($flight.live.updated)"
            }

            Write-Host "==============================="
            Write-Host ""
        }
    }
    else {
        Write-Host "No flight data returned."
    }
}
catch {
    Write-Host "Error calling API:"
    Write-Host $_
}