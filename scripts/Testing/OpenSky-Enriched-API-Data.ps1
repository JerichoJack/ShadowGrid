# Load databases
$aircraftDb = Import-Csv "public\aircraft-database-files\aircraftDatabase-New.csv"
$aircraftTypes = Import-Csv "public\aircraft-database-files\aircraftTypes.csv"
$manufacturers = Import-Csv "public\aircraft-database-files\manufacturers.csv"

# Convert aircraftDb to lookup by ICAO24
$aircraftLookup = @{}
foreach ($row in $aircraftDb) {
    $aircraftLookup[$row.icao24.ToLower()] = $row
}

# Convert aircraftTypes to lookup by Designator
$typesLookup = @{}
foreach ($row in $aircraftTypes) {
    $typesLookup[$row.Designator] = $row
}

# Convert manufacturers to lookup by Code
$manufacturersLookup = @{}
foreach ($row in $manufacturers) {
    $manufacturersLookup[$row.Code] = $row.Name
}

# Pull OpenSky data
$opensky = Invoke-RestMethod "https://opensky-network.org/api/states/all"

$TypeDesignatorIcons = @{
    'SHIP'   = @{ Icon = 'blimp'; Scale = 0.94 } # Blimp
    'BALL'   = @{ Icon = 'balloon'; Scale = 1 } # Balloon
    'A318'   = @{ Icon = 'a319'; Scale = 0.95 } # shortened a320 68t
    'A319'   = @{ Icon = 'a319'; Scale = 1 } # shortened a320 75t
    'A19N'   = @{ Icon = 'a319'; Scale = 1 } # shortened a320
    'A320'   = @{ Icon = 'a320'; Scale = 1 } # 78t
    'A20N'   = @{ Icon = 'a320'; Scale = 1 }
    'A321'   = @{ Icon = 'a321'; Scale = 1 } # stretched a320 93t
    'A21N'   = @{ Icon = 'a321'; Scale = 1 } # stretched a320
    'A306'   = @{ Icon = 'heavy_2e'; Scale = 0.93 }
    'A330'   = @{ Icon = 'a332'; Scale = 0.98 }
    'A332'   = @{ Icon = 'a332'; Scale = 0.99 }
    'A333'   = @{ Icon = 'a332'; Scale = 1.00 }
    'A338'   = @{ Icon = 'a332'; Scale = 1.00 } # 800 neo
    'A339'   = @{ Icon = 'a332'; Scale = 1.01 } # 900 neo
    'DC10'   = @{ Icon = 'md11'; Scale = 0.92 }
    'MD11'   = @{ Icon = 'md11'; Scale = 0.96 }
    'A359'   = @{ Icon = 'a359'; Scale = 1.00 }
    'A35K'   = @{ Icon = 'a359'; Scale = 1.02 }
    'A388'   = @{ Icon = 'a380'; Scale = 1 }
    # dubious since these are old-generation 737s
    # but the shape is similar
    'B731'   = @{ Icon = 'b737'; Scale = 0.90 } # len: 29m
    'B732'   = @{ Icon = 'b737'; Scale = 0.92 } # len: 31m
    'B735'   = @{ Icon = 'b737'; Scale = 0.96 } # len: 31m
    'B733'   = @{ Icon = 'b737'; Scale = 0.98 } # len: 33m
    'B734'   = @{ Icon = 'b737'; Scale = 0.98 } # len: 36m
    # next generation
    'B736'   = @{ Icon = 'b737'; Scale = 0.96 } # len: 31m
    'B737'   = @{ Icon = 'b737'; Scale = 1.00 } # len: 33m
    'B738'   = @{ Icon = 'b738'; Scale = 1.00 } # len: 39m
    'B739'   = @{ Icon = 'b739'; Scale = 1.00 } # len: 42m
    # max
    'B37M'   = @{ Icon = 'b737'; Scale = 1.02 } # len: 36m (not yet certified)
    'B38M'   = @{ Icon = 'b738'; Scale = 1.00 } # len: 39m
    'B39M'   = @{ Icon = 'b739'; Scale = 1.00 } # len: 42m
    'B3XM'   = @{ Icon = 'b739'; Scale = 1.01 } # len: 44m (not yet certified)
    'P8'     = @{ Icon = 'p8'; Scale = 1.00 }
    'P8 ?'   = @{ Icon = 'p8'; Scale = 1.00 }
    'E737'   = @{ Icon = 'e737'; Scale = 1.00 }
    'J328'   = @{ Icon = 'airliner'; Scale = 0.78 } # 15t
    'E170'   = @{ Icon = 'airliner'; Scale = 0.82 } # 38t
    'E75S/L' = @{ Icon = 'airliner'; Scale = 0.82 }
    'E75L'   = @{ Icon = 'airliner'; Scale = 0.82 }
    'E75S'   = @{ Icon = 'airliner'; Scale = 0.82 }  # 40t
    'A148'   = @{ Icon = 'airliner'; Scale = 0.83 } # 43t
    'RJ70'   = @{ Icon = 'b707'; Scale = 0.68 } # 38t
    'RJ85'   = @{ Icon = 'b707'; Scale = 0.68 } # 42t
    'RJ1H'   = @{ Icon = 'b707'; Scale = 0.68 } # 44t
    'B461'   = @{ Icon = 'b707'; Scale = 0.68 } # 44t
    'B462'   = @{ Icon = 'b707'; Scale = 0.68 } # 44t
    'B463'   = @{ Icon = 'b707'; Scale = 0.68 } # 44t
    'E190'   = @{ Icon = 'airliner'; Scale = 0.81 } # 52t
    'E195'   = @{ Icon = 'airliner'; Scale = 0.81 } # 52t
    'E290'   = @{ Icon = 'airliner'; Scale = 0.82 } # 56t
    'E295'   = @{ Icon = 'airliner'; Scale = 0.83 } # 62t
    'BCS1'   = @{ Icon = 'airliner'; Scale = 0.835 } # 64t
    'BCS3'   = @{ Icon = 'airliner'; Scale = 0.85 } # 70t
    'B741'   = @{ Icon = 'heavy_4e'; Scale = 0.96 }
    'B742'   = @{ Icon = 'heavy_4e'; Scale = 0.96 }
    'B743'   = @{ Icon = 'heavy_4e'; Scale = 0.96 }
    'B744'   = @{ Icon = 'heavy_4e'; Scale = 0.96 }
    'B74D'   = @{ Icon = 'heavy_4e'; Scale = 0.96 }
    'B74S'   = @{ Icon = 'heavy_4e'; Scale = 0.96 }
    'B74R'   = @{ Icon = 'heavy_4e'; Scale = 0.96 }
    'BLCF'   = @{ Icon = 'heavy_4e'; Scale = 0.96 }
    'BSCA'   = @{ Icon = 'heavy_4e'; Scale = 0.96 } # hah!
    'B748'   = @{ Icon = 'heavy_4e'; Scale = 0.98 }
    'B752'   = @{ Icon = 'heavy_2e'; Scale = 0.9 }
    'B753'   = @{ Icon = 'heavy_2e'; Scale = 0.9 }
    'B772'   = @{ Icon = 'heavy_2e'; Scale = 1.00 } # all pretty similar except for length
    'B773'   = @{ Icon = 'heavy_2e'; Scale = 1.02 }
    'B77L'   = @{ Icon = 'heavy_2e'; Scale = 1.02 }
    'B77W'   = @{ Icon = 'heavy_2e'; Scale = 1.04 }
    'B701'   = @{ Icon = 'b707'; Scale = 1 }
    'B703'   = @{ Icon = 'b707'; Scale = 1 }
    'K35R'   = @{ Icon = 'b707'; Scale = 1 }
    'K35E'   = @{ Icon = 'b707'; Scale = 1 }
    'FA20'   = @{ Icon = 'jet_swept'; Scale = 0.92 } # 13t
    'C680'   = @{ Icon = 'jet_swept'; Scale = 0.92 } # 14t
    'C68A'   = @{ Icon = 'jet_swept'; Scale = 0.92 } # 14t
    'YK40'   = @{ Icon = 'jet_swept'; Scale = 0.94 } # 16t
    'C750'   = @{ Icon = 'jet_swept'; Scale = 0.94 } # 17t
    'F2TH'   = @{ Icon = 'jet_swept'; Scale = 0.94 } # 16t
    'FA50'   = @{ Icon = 'jet_swept'; Scale = 0.94 } # 18t
    'CL30'   = @{ Icon = 'jet_swept'; Scale = 0.92 } # 14t
    'CL35'   = @{ Icon = 'jet_swept'; Scale = 0.92 }
    'F900'   = @{ Icon = 'jet_swept'; Scale = 0.96 } # 21t
    'CL60'   = @{ Icon = 'jet_swept'; Scale = 0.96 } # 22t
    'G200'   = @{ Icon = 'jet_swept'; Scale = 0.92 } # 16t
    'G280'   = @{ Icon = 'jet_swept'; Scale = 0.92 } # 18t
    'HA4T'   = @{ Icon = 'jet_swept'; Scale = 0.92 } # 18t
    'FA7X'   = @{ Icon = 'jet_swept'; Scale = 0.96 } # 29t
    'FA8X'   = @{ Icon = 'jet_swept'; Scale = 0.96 } # 33t
    'GLF2'   = @{ Icon = 'jet_swept'; Scale = 0.96 } # 29t
    'GLF3'   = @{ Icon = 'jet_swept'; Scale = 0.96 } # 31t
    'GLF4'   = @{ Icon = 'jet_swept'; Scale = 0.96 } # 34t
    'GA5C'   = @{ Icon = 'jet_swept'; Scale = 0.96 } # 34t
    'GL5T'   = @{ Icon = 'jet_swept'; Scale = 0.98 } # 40t
    'GLF5'   = @{ Icon = 'jet_swept'; Scale = 0.98 } # 41t
    'GA6C'   = @{ Icon = 'jet_swept'; Scale = 0.98 } # 41t
    'GLEX'   = @{ Icon = 'jet_swept'; Scale = 1 } # 45t
    'GL6T'   = @{ Icon = 'jet_swept'; Scale = 1 } # 45t
    'GLF6'   = @{ Icon = 'jet_swept'; Scale = 1 } # 48t
    'GA7C'   = @{ Icon = 'jet_swept'; Scale = 1 } # 48t
    'GA8C'   = @{ Icon = 'jet_swept'; Scale = 1 } # 48t (fantasy type but in the database)
    'GL7T'   = @{ Icon = 'jet_swept'; Scale = 1 } # 52t
    'E135'   = @{ Icon = 'jet_swept'; Scale = 0.92 } # 20t
    'E35L'   = @{ Icon = 'jet_swept'; Scale = 0.92 } # 24t
    'E145'   = @{ Icon = 'jet_swept'; Scale = 0.92 } # 22t
    'E45X'   = @{ Icon = 'jet_swept'; Scale = 0.92 } # 24t
    'E390'   = @{ Icon = 'e390'; Scale = 1 }
    'CRJ1'   = @{ Icon = 'jet_swept'; Scale = 0.92 } # 24t
    'CRJ2'   = @{ Icon = 'jet_swept'; Scale = 0.92 } # 24t
    'F28'    = @{ Icon = 'jet_swept'; Scale = 0.93 } # 32t
    'CRJ7'   = @{ Icon = 'jet_swept'; Scale = 0.94 } # 34t
    'CRJ9'   = @{ Icon = 'jet_swept'; Scale = 0.96 } # 38t
    'F70'    = @{ Icon = 'jet_swept'; Scale = 0.97 } # 40
    'CRJX'   = @{ Icon = 'jet_swept'; Scale = 0.98 } # 41t
    'F100'   = @{ Icon = 'jet_swept'; Scale = 1 } # 45t
    'DC91'   = @{ Icon = 'jet_swept'; Scale = 1 }
    'DC92'   = @{ Icon = 'jet_swept'; Scale = 1 }
    'DC93'   = @{ Icon = 'jet_swept'; Scale = 1 }
    'DC94'   = @{ Icon = 'jet_swept'; Scale = 1 }
    'DC95'   = @{ Icon = 'jet_swept'; Scale = 1 }
    'MD80'   = @{ Icon = 'jet_swept'; Scale = 1.06 } # 60t
    'MD81'   = @{ Icon = 'jet_swept'; Scale = 1.06 }
    'MD82'   = @{ Icon = 'jet_swept'; Scale = 1.06 }
    'MD83'   = @{ Icon = 'jet_swept'; Scale = 1.06 }
    'MD87'   = @{ Icon = 'jet_swept'; Scale = 1.06 }
    'MD88'   = @{ Icon = 'jet_swept'; Scale = 1.06 } # 72t
    'MD90'   = @{ Icon = 'jet_swept'; Scale = 1.06 }
    'B712'   = @{ Icon = 'jet_swept'; Scale = 1.06 } # 54t
    'B721'   = @{ Icon = 'jet_swept'; Scale = 1.10 } # 80t
    'B722'   = @{ Icon = 'jet_swept'; Scale = 1.10 } # 80t
    'T154'   = @{ Icon = 'jet_swept'; Scale = 1.12 } # 100t
    'BE40'   = @{ Icon = 'jet_nonswept'; Scale = 1 } # 7.3t
    'FA10'   = @{ Icon = 'jet_nonswept'; Scale = 1 } # 8t
    'C501'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'C510'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'C25A'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'C25B'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'C25C'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'C525'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'C550'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'C560'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'C56X'   = @{ Icon = 'jet_nonswept'; Scale = 1 } # 9t
    'LJ23'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'LJ24'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'LJ25'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'LJ28'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'LJ31'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'LJ35'   = @{ Icon = 'jet_nonswept'; Scale = 1 } # 8t
    'LR35'   = @{ Icon = 'jet_nonswept'; Scale = 1 } # wrong but in DB
    'LJ40'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'LJ45'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'LR45'   = @{ Icon = 'jet_nonswept'; Scale = 1 } # wrong but in DB
    'LJ55'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'LJ60'   = @{ Icon = 'jet_nonswept'; Scale = 1 } # 10t
    'LJ70'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'LJ75'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'LJ85'   = @{ Icon = 'jet_nonswept'; Scale = 1 }
    'C650'   = @{ Icon = 'jet_nonswept'; Scale = 1.03 } # 11t
    'ASTR'   = @{ Icon = 'jet_nonswept'; Scale = 1.03 } # 11t
    'G150'   = @{ Icon = 'jet_nonswept'; Scale = 1.03 } # 11t
    'H25A'   = @{ Icon = 'jet_nonswept'; Scale = 1.03 } # 12t
    'H25B'   = @{ Icon = 'jet_nonswept'; Scale = 1.03 } # 12t
    'H25C'   = @{ Icon = 'jet_nonswept'; Scale = 1.03 } # 12t
    'PRM1'   = @{ Icon = 'jet_nonswept'; Scale = 0.96 }
    'E55P'   = @{ Icon = 'jet_nonswept'; Scale = 0.96 }
    'E50P'   = @{ Icon = 'jet_nonswept'; Scale = 0.96 }
    'EA50'   = @{ Icon = 'jet_nonswept'; Scale = 0.96 }
    'HDJT'   = @{ Icon = 'jet_nonswept'; Scale = 0.96 }
    'SF50'   = @{ Icon = 'jet_nonswept'; Scale = 0.94 }
    'C97'    = @{ Icon = 'super_guppy'; Scale = 1 }
    'SGUP'   = @{ Icon = 'super_guppy'; Scale = 1 }
    'A3ST'   = @{ Icon = 'beluga'; Scale = 1 }
    'A337'   = @{ Icon = 'beluga'; Scale = 1.06 }
    'WB57'   = @{ Icon = 'wb57'; Scale = 1 }
    'A37'    = @{ Icon = 'hi_perf'; Scale = 1 }
    'A700'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'LEOP'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'ME62'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'T2'     = @{ Icon = 'hi_perf'; Scale = 1 }
    'T37'    = @{ Icon = 'hi_perf'; Scale = 1 }
    'T38'    = @{ Icon = 't38'; Scale = 1 }
    'F104'   = @{ Icon = 't38'; Scale = 1 }
    'A10'    = @{ Icon = 'a10'; Scale = 1 }
    'A3'     = @{ Icon = 'hi_perf'; Scale = 1 }
    'A6'     = @{ Icon = 'hi_perf'; Scale = 1 }
    'AJET'   = @{ Icon = 'alpha_jet'; Scale = 1 }
    'AT3'    = @{ Icon = 'hi_perf'; Scale = 1 }
    'CKUO'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'EUFI'   = @{ Icon = 'typhoon'; Scale = 1 }
    'SB39'   = @{ Icon = 'sb39'; Scale = 1 }
    'MIR2'   = @{ Icon = 'mirage'; Scale = 1 }
    'KFIR'   = @{ Icon = 'mirage'; Scale = 1 }
    'F1'     = @{ Icon = 'hi_perf'; Scale = 1 }
    'F111'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'F117'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'F14'    = @{ Icon = 'hi_perf'; Scale = 1 }
    'F15'    = @{ Icon = 'md_f15'; Scale = 1 }
    'F16'    = @{ Icon = 'hi_perf'; Scale = 1 }
    'F18'    = @{ Icon = 'f18'; Scale = 1 }
    'F18H'   = @{ Icon = 'f18'; Scale = 1 }
    'F18S'   = @{ Icon = 'f18'; Scale = 1 }
    'F22'    = @{ Icon = 'f35'; Scale = 1 }
    'F22A'   = @{ Icon = 'f35'; Scale = 1 }
    'F35'    = @{ Icon = 'f35'; Scale = 1 }
    'VF35'   = @{ Icon = 'f35'; Scale = 1 }
    'L159'   = @{ Icon = 'l159'; Scale = 1 }
    'L39'    = @{ Icon = 'l159'; Scale = 1 }
    'F4'     = @{ Icon = 'hi_perf'; Scale = 1 }
    'F5'     = @{ Icon = 'f5_tiger'; Scale = 1 }
    'HUNT'   = @{ Icon = 'hunter'; Scale = 1 }
    'LANC'   = @{ Icon = 'lancaster'; Scale = 1 }
    'B17'    = @{ Icon = 'lancaster'; Scale = 1 }
    'B29'    = @{ Icon = 'lancaster'; Scale = 1 }
    'J8A'    = @{ Icon = 'hi_perf'; Scale = 1 }
    'J8B'    = @{ Icon = 'hi_perf'; Scale = 1 }
    'JH7'    = @{ Icon = 'hi_perf'; Scale = 1 }
    'LTNG'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'M346'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'METR'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'MG19'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'MG25'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'MG29'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'MG31'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'MG44'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'MIR4'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'MT2'    = @{ Icon = 'hi_perf'; Scale = 1 }
    'Q5'     = @{ Icon = 'hi_perf'; Scale = 1 }
    'RFAL'   = @{ Icon = 'rafale'; Scale = 1 }
    'S3'     = @{ Icon = 'hi_perf'; Scale = 1 }
    'S37'    = @{ Icon = 'hi_perf'; Scale = 1 }
    'SR71'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'SU15'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'SU24'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'SU25'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'SU27'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'T22M'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'T4'     = @{ Icon = 'hi_perf'; Scale = 1 }
    'TOR'    = @{ Icon = 'tornado'; Scale = 1 }
    'A4'     = @{ Icon = 'md_a4'; Scale = 1 }
    'TU22'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'VAUT'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'Y130'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'YK28'   = @{ Icon = 'hi_perf'; Scale = 1 }
    'BE20'   = @{ Icon = 'twin_large'; Scale = 0.92 }
    'IL62'   = @{ Icon = 'il_62'; Scale = 1 }
    'MRF1'   = @{ Icon = 'miragef1'; Scale = 0.75 }
    'M326'   = @{ Icon = 'm326'; Scale = 1 }
    'M339'   = @{ Icon = 'm326'; Scale = 1 }
    'FOUG'   = @{ Icon = 'm326'; Scale = 1 }
    'T33'    = @{ Icon = 'm326'; Scale = 1 }
    'A225'   = @{ Icon = 'a225'; Scale = 1 }
    'A124'   = @{ Icon = 'b707'; Scale = 1.18 }
    'SLCH'   = @{ Icon = 'strato'; Scale = 1 }
    'WHK2'   = @{ Icon = 'strato'; Scale = 0.9 }
    'C130'   = @{ Icon = 'c130'; Scale = 1.07 }
    'C30J'   = @{ Icon = 'c130'; Scale = 1.07 }
    'P3'     = @{ Icon = 'p3_orion'; Scale = 1 }
    'PARA'   = @{ Icon = 'para'; Scale = 1 }
    'DRON'   = @{ Icon = 'uav'; Scale = 1 }
    'Q1'     = @{ Icon = 'uav'; Scale = 1 }
    'Q4'     = @{ Icon = 'uav'; Scale = 1 }
    'Q9'     = @{ Icon = 'uav'; Scale = 1 }
    'Q25'    = @{ Icon = 'uav'; Scale = 1 }
    'HRON'   = @{ Icon = 'uav'; Scale = 1 }
    'A400'   = @{ Icon = 'a400'; Scale = 1 }
    'V22F'   = @{ Icon = 'v22_fast'; Scale = 1 }
    'V22'    = @{ Icon = 'v22_slow'; Scale = 1 }
    'B609F'  = @{ Icon = 'v22_fast'; Scale = 0.86 }
    'B609'   = @{ Icon = 'v22_slow'; Scale = 0.86 }
    'H64'    = @{ Icon = 'apache'; Scale = 1 }
    # 4 bladed heavy helicopters
    'H60'    = @{ Icon = 'blackhawk'; Scale = 1 } # 11t
    'S92'    = @{ Icon = 'blackhawk'; Scale = 1 } # 12t
    'NH90'   = @{ Icon = 'blackhawk'; Scale = 1 } # 11t
    # Puma, Super Puma, Oryx, Cougar (ICAO'S AS32 & AS3B & PUMA)
    'AS32'   = @{ Icon = 'puma'; Scale = 1.03 } # 9t
    'AS3B'   = @{ Icon = 'puma'; Scale = 1.03 } # 9t
    'PUMA'   = @{ Icon = 'puma'; Scale = 1.03 } # 9t
    'TIGR'   = @{ Icon = 'tiger'; Scale = 1.00 }
    'MI24'   = @{ Icon = 'mil24'; Scale = 1.00 }
    'AS65'   = @{ Icon = 'dauphin'; Scale = 0.85 }
    'S76'    = @{ Icon = 'dauphin'; Scale = 0.86 }
    'GAZL'   = @{ Icon = 'gazelle'; Scale = 1.00 }
    'AS50'   = @{ Icon = 'gazelle'; Scale = 1.00 }
    'AS55'   = @{ Icon = 'gazelle'; Scale = 1.00 }
    'ALO2'   = @{ Icon = 'gazelle'; Scale = 1.00 }
    'ALO3'   = @{ Icon = 'gazelle'; Scale = 1.00 }
    'R22'    = @{ Icon = 'helicopter'; Scale = 0.92 }
    'R44'    = @{ Icon = 'helicopter'; Scale = 0.94 }
    'R66'    = @{ Icon = 'helicopter'; Scale = 0.98 }
    # 5 bladed
    'EC55'   = @{ Icon = 's61'; Scale = 0.94 } # 5t
    'A169'   = @{ Icon = 's61'; Scale = 0.94 } # 5t
    'H160'   = @{ Icon = 's61'; Scale = 0.95 } # 6t
    'A139'   = @{ Icon = 's61'; Scale = 0.96 } # 7t
    'EC75'   = @{ Icon = 's61'; Scale = 0.97 } # 8t
    'A189'   = @{ Icon = 's61'; Scale = 0.98 } # 8.3t
    'A149'   = @{ Icon = 's61'; Scale = 0.98 } # 8.6t
    'S61'    = @{ Icon = 's61'; Scale = 0.98 } # 8.6t
    'S61R'   = @{ Icon = 's61'; Scale = 1 } # 10t
    'EC25'   = @{ Icon = 's61'; Scale = 1.01 } # 11t
    'EH10'   = @{ Icon = 's61'; Scale = 1.04 } # 14.5t (AW101)
    'H53'    = @{ Icon = 's61'; Scale = 1.1 } # 19t
    'H53S'   = @{ Icon = 's61'; Scale = 1.1 } # 19t
    'U2'     = @{ Icon = 'u2'; Scale = 1 }
    'C2'     = @{ Icon = 'c2'; Scale = 1 }
    'E2'     = @{ Icon = 'c2'; Scale = 1 }
    'H47'    = @{ Icon = 'chinook'; Scale = 1 }
    'H46'    = @{ Icon = 'chinook'; Scale = 1 }
    'HAWK'   = @{ Icon = 'bae_hawk'; Scale = 1 }
    'GYRO'   = @{ Icon = 'gyrocopter'; Scale = 1 }
    'DLTA'   = @{ Icon = 'verhees'; Scale = 1 }
    'B1'     = @{ Icon = 'b1b_lancer'; Scale = 1.0 }
    'B52'    = @{ Icon = 'b52'; Scale = 1 }
    'C17'    = @{ Icon = 'c17'; Scale = 1.25 }
    'C5M'    = @{ Icon = 'c5'; Scale = 1.18 }
    'E3TF'   = @{ Icon = 'e3awacs'; Scale = 0.88 }
    'E3CF'   = @{ Icon = 'e3awacs'; Scale = 0.88 }
    #
    'GLID'   = @{ Icon = 'glider'; Scale = 1 }
    # Stemme
    'S6'     = @{ Icon = 'glider'; Scale = 1 }
    'S10S'   = @{ Icon = 'glider'; Scale = 1 }
    'S12'    = @{ Icon = 'glider'; Scale = 1 }
    'S12S'   = @{ Icon = 'glider'; Scale = 1 }
    # Schempp-Hirth
    'ARCE'   = @{ Icon = 'glider'; Scale = 1 }
    'ARCP'   = @{ Icon = 'glider'; Scale = 1 }
    'DISC'   = @{ Icon = 'glider'; Scale = 1 }
    'DUOD'   = @{ Icon = 'glider'; Scale = 1 }
    'JANU'   = @{ Icon = 'glider'; Scale = 1 }
    'NIMB'   = @{ Icon = 'glider'; Scale = 1 }
    'QINT'   = @{ Icon = 'glider'; Scale = 1 }
    'VENT'   = @{ Icon = 'glider'; Scale = 1 }
    'VNTE'   = @{ Icon = 'glider'; Scale = 1 }
    # Schleicher
    'A20J'   = @{ Icon = 'glider'; Scale = 1 }
    'A32E'   = @{ Icon = 'glider'; Scale = 1 }
    'A32P'   = @{ Icon = 'glider'; Scale = 1 }
    'A33E'   = @{ Icon = 'glider'; Scale = 1 }
    'A33P'   = @{ Icon = 'glider'; Scale = 1 }
    'A34E'   = @{ Icon = 'glider'; Scale = 1 }
    'AS14'   = @{ Icon = 'glider'; Scale = 1 }
    'AS16'   = @{ Icon = 'glider'; Scale = 1 }
    'AS20'   = @{ Icon = 'glider'; Scale = 1 }
    'AS21'   = @{ Icon = 'glider'; Scale = 1 }
    'AS22'   = @{ Icon = 'glider'; Scale = 1 }
    'AS24'   = @{ Icon = 'glider'; Scale = 1 }
    'AS25'   = @{ Icon = 'glider'; Scale = 1 }
    'AS26'   = @{ Icon = 'glider'; Scale = 1 }
    'AS28'   = @{ Icon = 'glider'; Scale = 1 }
    'AS29'   = @{ Icon = 'glider'; Scale = 1 }
    'AS30'   = @{ Icon = 'glider'; Scale = 1 }
    'AS31'   = @{ Icon = 'glider'; Scale = 1 }
    # DG
    'DG80'   = @{ Icon = 'glider'; Scale = 1 }
    'DG1T'   = @{ Icon = 'glider'; Scale = 1 }
    'LS10'   = @{ Icon = 'glider'; Scale = 1 }
    'LS9'    = @{ Icon = 'glider'; Scale = 1 }
    'LS8'    = @{ Icon = 'glider'; Scale = 1 }
    # Jonker
    'TS1J'   = @{ Icon = 'glider'; Scale = 1 }
    # PIK
    'PK20'   = @{ Icon = 'glider'; Scale = 1 }
    # LAK
    'LK17'   = @{ Icon = 'glider'; Scale = 1 }
    'LK19'   = @{ Icon = 'glider'; Scale = 1 }
    'LK20'   = @{ Icon = 'glider'; Scale = 1 }
    'ULAC'   = $ULAC
    'EV97'   = $ULAC
    'FDCT'   = $ULAC
    'WT9'    = $ULAC
    'PIVI'   = $ULAC
    'FK9'    = $ULAC
    'AVID'   = $ULAC
    'NG5'    = $ULAC
    'PNR3'   = $ULAC
    'TL20'   = $ULAC
    'SR20'   = @{ Icon = 'cirrus_sr22'; Scale = 1 }
    'SR22'   = @{ Icon = 'cirrus_sr22'; Scale = 1 }
    'S22T'   = @{ Icon = 'cirrus_sr22'; Scale = 1 }
    'VEZE'   = @{ Icon = 'rutan_veze'; Scale = 1 }
    'VELO'   = @{ Icon = 'rutan_veze'; Scale = 1.04 }
    'PRTS'   = @{ Icon = 'rutan_veze'; Scale = 1.3 } # approximation for canard configuration
    'PA24'   = @{ Icon = 'pa24'; Scale = 1 }
    'GND'    = @{ Icon = 'ground_unknown'; Scale = 1 }
    'GRND'   = @{ Icon = 'ground_unknown'; Scale = 1 }
    'SERV'   = @{ Icon = 'ground_service'; Scale = 1 }
    'EMER'   = @{ Icon = 'ground_emergency'; Scale = 1 }
    'TWR'    = @{ Icon = 'ground_tower'; Scale = 1 }
}

$enriched = $opensky.states | ForEach-Object {

    $icao = $_[0].ToLower()
    $meta = $aircraftLookup[$icao]

    $callsign = if ($_[1]) { $_[1].Trim() } else { "" }
    $latitude = $_[6]
    $longitude = $_[5]
    $altitude = $_[7]
    $velocity = $_[9]
    $heading = $_[10]
    $lastUpdate = $_[4]

    if ($meta) {

        # Safe typecode handling
        $typecode = if ($meta.typecode) { $meta.typecode.Trim().ToUpper() } else { $null }
        $typeInfo = if ($typecode) { $typesLookup[$typecode] } else { $null }

        # ---------------------------
        # 1. Detect Airframe Type
        # ---------------------------
        $airframeType = "Unknown"

        if ($typecode -and $typecode -match '^(H|R44|R22|EC|AS|MI|S92|H60|H47)') {
            $airframeType = "Helicopter"
        }
        elseif ($typecode -and $typecode -match '^(Q|DRON)') {
            $airframeType = "UAV"
        }
        else {
            $airframeType = "FixedWing"
        }

        # ---------------------------
        # 2. Detect Military vs Civilian
        # ---------------------------
        $category = "Civilian"

        if ($typecode -and $typecode -match '^(F|A10|B1|B52|C17|C5|E3|KC|RC|P8|U2|SR71)') {
            $category = "Military"
        }
        elseif ($meta.registration -and $meta.registration -match '^(N|G|D|F)') {
            $category = "Civilian"
        }
        else {
            $category = "Unknown"
        }

        # ---------------------------
        # 3. Detect Role
        # ---------------------------
        $role = "Unknown"

        if ($typecode -and $typecode -match '^(B7|A3|A2|E19|E17|BCS)') {
            $role = "Airliner"
        }
        elseif ($typecode -and $typecode -match '^(C17|C5|C130|A400)') {
            $role = "Cargo"
        }
        elseif ($typecode -and $typecode -match '^(KC|K35)') {
            $role = "Tanker"
        }
        elseif ($typecode -and $typecode -match '^(E3|E737)') {
            $role = "AWACS"
        }
        elseif ($typecode -and $typecode -match '^(F|SU|MG|MIR|RFAL)') {
            $role = "Fighter"
        }
        elseif ($airframeType -eq "Helicopter") {
            $role = "Helicopter"
        }

        # ---------------------------
        # 4. Behavioral inference
        # ---------------------------
        if ($role -eq "Unknown") {
            if ($velocity -and $altitude) {
                if ($velocity -lt 60 -and $altitude -lt 5000) {
                    $role = "Helicopter"
                }
                elseif ($velocity -gt 400 -and $altitude -gt 30000) {
                    $role = "Jet"
                }
                elseif ($velocity -lt 250 -and $altitude -lt 15000) {
                    $role = "PropAircraft"
                }
            }
        }

        # ---------------------------
        # 5. Shape selection
        # ---------------------------
        $shape = $null
        $shapeSource = "Unknown"

        # Exact match
        if ($typecode -and $TypeDesignatorIcons.ContainsKey($typecode)) {
            $shape = $TypeDesignatorIcons[$typecode]
            $shapeSource = "Exact"
        }

        # Role fallback
        if (-not $shape) {
            switch ($role) {
                "Fighter" {
                    $shape = @{ Icon='hi_perf'; Scale=1 }
                    $shapeSource = "RoleInference"
                }
                "Tanker" {
                    $shape = @{ Icon='b707'; Scale=1 }
                    $shapeSource = "RoleInference"
                }
                "AWACS" {
                    $shape = @{ Icon='e3awacs'; Scale=1 }
                    $shapeSource = "RoleInference"
                }
                "Cargo" {
                    $shape = @{ Icon='c17'; Scale=1 }
                    $shapeSource = "RoleInference"
                }
                "Helicopter" {
                    $shape = @{ Icon='helicopter'; Scale=1 }
                    $shapeSource = "RoleInference"
                }
                "Airliner" {
                    $shape = @{ Icon='a320'; Scale=1 }
                    $shapeSource = "RoleInference"
                }
            }
        }

        # Final fallback
        if (-not $shape) {
            $shape = @{ Icon='unknown'; Scale=1 }
            $shapeSource = "Fallback"
        }

        # Log missing mappings
        if ($typecode -and -not $TypeDesignatorIcons.ContainsKey($typecode)) {
            Add-Content "scripts\outputs\missing_typecodes.txt" $typecode
        }

        [PSCustomObject]@{
            ICAO24       = $icao
            Callsign     = $callsign
            Latitude     = $latitude
            Longitude    = $longitude
            Altitude     = $altitude
            Velocity     = $velocity
            Heading      = $heading
            LastUpdate   = $lastUpdate

            TypeCode     = $typecode
            Model        = $meta.model
            Registration = $meta.registration

            Category     = $category
            AirframeType = $airframeType
            Role         = $role

            Shape        = $shape
            ShapeSource  = $shapeSource
        }
    }
    else {
        # Fallback when no metadata exists
        [PSCustomObject]@{
            ICAO24       = $icao
            Callsign     = $callsign
            Latitude     = $latitude
            Longitude    = $longitude
            Altitude     = $altitude
            Velocity     = $velocity
            Heading      = $heading
            LastUpdate   = $lastUpdate

            TypeCode     = $null
            Model        = $null
            Registration = $null

            Category     = "Unknown"
            AirframeType = "Unknown"
            Role         = "Unknown"

            Shape        = @{ Icon='unknown'; Scale=1 }
            ShapeSource  = "NoMetadata"
        }
    }
}

# Save enriched snapshot
$enriched | ConvertTo-Json -Depth 6 | Out-File "scripts\outputs\opensky_enriched_snapshot.json"

Write-Host "Enriched OpenSky snapshot saved!"