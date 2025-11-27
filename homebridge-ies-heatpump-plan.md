# Homebridge IES Heat Pump Plugin - Technical Plan

## Overview

Build a Homebridge plugin to integrate IES/Xterra heat pumps with Apple HomeKit. The heat pump uses a cloud-based API at `ies-heatpumps.com` with OpenID Connect authentication.

## Authentication

### OpenID Connect Flow

- **Discovery endpoint:** `https://login.ies-heatpumps.com/.well-known/openid-configuration`
- **Token endpoint:** `https://login.ies-heatpumps.com/connect/token`
- **Authorization endpoint:** `https://login.ies-heatpumps.com/connect/authorize`

### Web Client Auth (what works)

The web client uses authorization code flow with these parameters:
- `client_id`: `BitzerIoC.Web`
- `redirect_uri`: `https://www.ies-heatpumps.com/signin-oidc`
- `scope`: `openid profile webapi_scope`
- `response_type`: `code id_token`

**Note:** Password grant is NOT supported for `BitzerIoC.Web` (returns `unauthorized_client`).

### Session Management

After OIDC login, the web app uses ASP.NET Core cookie authentication:
- `.AspNetCore.CookiesC1` and `.AspNetCore.CookiesC2` (chunked session cookie)
- `.AspNetCore.Antiforgery.*` (CSRF protection)

### Recommended Auth Strategy for Plugin

1. **Option A - Headless browser:** Use Puppeteer/Playwright to complete OIDC flow and extract cookies
2. **Option B - Manual cookie input:** User provides cookies from browser session (simpler but requires periodic refresh)
3. **Option C - Investigate mobile app client_id:** The iOS app likely uses a different client_id that supports password grant - would need further reverse engineering

## API Endpoints

Base URL: `https://www.ies-heatpumps.com`

### Read Monitoring Data

```
GET /Monitoring/AsJSON/?deviceId={deviceId}&_={timestamp}
```

- `deviceId`: Device identifier (e.g., `999`)
- `_`: Cache-buster timestamp (optional)
- **Auth:** Requires session cookies
- **Returns:** JSON with `groups` array containing parameters

### Read Settings

Same endpoint but returns different `viewId` based on page context (likely session state).

Settings are returned with `viewId: 1`, monitoring with `viewId: 6`.

### Write Settings

```
POST /Configurations/Save
Content-Type: application/x-www-form-urlencoded
```

**Required fields:**
- `hdnDeviceId`: Device ID (e.g., `999`)
- `__RequestVerificationToken`: CSRF token (extract from page HTML)
- Parameter fields with suffixes:
  - `_T` for numeric inputs (e.g., `_USER_HeatSPCtrl_ToffSet_T=5.0`)
  - `_C` for dropdown selects (e.g., `_USER_Parameters_MainSwitch_C=1`)

**CSRF Token Location:**
```html
<input name="__RequestVerificationToken" type="hidden" value="..." />
```

## Data Model

### Monitoring Parameters (Read-Only)

| HomeKit Use | Parameter ID | Type | Unit |
|-------------|--------------|------|------|
| Flow Temperature | `_USER.Input.THeatSupply` | number | °C |
| Return Temperature | `_USER.Input.THeatReturn` | number | °C |
| Hot Water Tank Temp | `_USER.Input.TWaterTank` | number | °C |
| Outdoor Temperature | `_USER.Input.Tamb` | number | °C |
| Heat Pump State | `_USER.HeatPump.State` | enum | - |
| Season State | `_USER.HeatPump.SeasonState` | enum | - |
| Capacity | `_USER.HeatPump.CapacityAct` | number | % |
| Calculated Setpoint | `_USER.HeatSPCtrl.TsetAct` | number | °C |
| Compressor 1 | `_USER.Output.Compressor1` | bool | - |
| Compressor 2 | `_USER.Output.Compressor2` | bool | - |
| Compressor 1 Speed | `_USER.Output.CompVolt1` | number | V |
| Compressor 2 Speed | `_USER.Output.CompVolt2` | number | V |
| Heater | `_USER.Output.Heater` | bool | - |
| Hot Water Valve | `_USER.Output.HotTapWater` | bool | - |
| Operation Hours | `_USER.HeatPump.RunTime` | number | h |
| Suction Pressure | `_USER.Pressure.Psuc` | number | bar |
| Discharge Pressure | `_USER.Pressure.Pdis` | number | bar |
| Superheat | `_USER.EEVCtrl.SuperHeatAct` | number | °C |
| Evaporation Temp | `_USER.EEVCtrl.T0` | number | °C |
| EEV Position | `_USER.EEVCtrl.EEVSetp` | number | % |

### Settings Parameters (Read/Write)

| HomeKit Use | Parameter ID | Form Field | Type | Range |
|-------------|--------------|------------|------|-------|
| Main Switch | `_USER.Parameters.MainSwitch` | `_USER_Parameters_MainSwitch_C` | enum | 0=Off, 1=On |
| Season Mode | `_USER.Parameters.SeasonMode` | `_USER_Parameters_SeasonMode_C` | enum | 0=Summer, 1=Winter, 2=Auto |
| Curve Offset | `_USER.HeatSPCtrl.ToffSet` | `_USER_HeatSPCtrl_ToffSet_T` | number | -10 to +10 °C |
| Hot Water Setpoint | `_USER.HotWater.SetPoint` | `_USER_HotWater_SetPoint_T` | number | 5-70 °C |
| Compensation Type | `_USER.HeatSPCtrl.Type` | `_USER_HeatSPCtrl_Type_C` | enum | 0-7 |
| Curve Select | `_USER.HeatSPCtrl.Curve` | `_USER_HeatSPCtrl_Curve_C` | enum | 0-10 |
| Heating Source | `_USER.Heating.Source` | `_USER_Heating_Source_C` | enum | 0-3 |
| Hot Water Source | `_USER.HotWater.Source` | `_USER_HotWater_Source_C` | enum | 0-9 |

### Enum Mappings

**Heat Pump State (`_USER.HeatPump.State`):**
- `TOGGLE_VALUE_OFFON_0` = Off
- `TXT_TGT_STATE1` through `TXT_TGT_STATE29` = Various operating states
- `TXT_TGT_STATE5` = Heating (commonly observed)

**Season State (`_USER.HeatPump.SeasonState`):**
- `TXT_TGT_SEA_STATE0` = Summer
- `TXT_TGT_SEA_STATE1` = Winter

**On/Off values:**
- `TOGGLE_VALUE_OFFON_0` = Off
- `TOGGLE_VALUE_OFFON_1` = On

## HomeKit Service Mapping

### Primary Accessories

#### 1. Thermostat (Main Heat Pump Control)
```
Service: Thermostat
Characteristics:
  - CurrentHeatingCoolingState: Derived from _USER.HeatPump.State
  - TargetHeatingCoolingState: Map to Season Mode (heat/cool/auto)
  - CurrentTemperature: _USER.Input.THeatSupply (flow temp)
  - TargetTemperature: _USER.HeatSPCtrl.TsetAct (calculated setpoint) - read only
                       OR use Curve Offset as an adjustment
```

#### 2. Thermostat (Hot Water)
```
Service: Thermostat
Characteristics:
  - CurrentTemperature: _USER.Input.TWaterTank
  - TargetTemperature: _USER.HotWater.SetPoint (writable)
  - CurrentHeatingCoolingState: Derived from _USER.Output.HotTapWater
```

#### 3. Switch (Main Power)
```
Service: Switch
Characteristics:
  - On: _USER.Parameters.MainSwitch
```

### Sensor Accessories

#### 4. Temperature Sensor (Flow)
```
Service: TemperatureSensor
Characteristics:
  - CurrentTemperature: _USER.Input.THeatSupply
  - Name: "Flow Temperature"
```

#### 5. Temperature Sensor (Return)
```
Service: TemperatureSensor
Characteristics:
  - CurrentTemperature: _USER.Input.THeatReturn
  - Name: "Return Temperature"
```

#### 6. Temperature Sensor (Hot Water Tank)
```
Service: TemperatureSensor
Characteristics:
  - CurrentTemperature: _USER.Input.TWaterTank
  - Name: "Hot Water Tank"
```

#### 7. Temperature Sensor (Outdoor) - Optional
```
Service: TemperatureSensor
Characteristics:
  - CurrentTemperature: _USER.Input.Tamb
  - Name: "Outdoor Temperature"
  - Note: May show invalid readings if sensor not installed (-69.6°C)
```

### Optional Advanced Accessories

#### 8. Occupancy Sensor (Compressor 1 Running)
```
Service: OccupancySensor
Characteristics:
  - OccupancyDetected: _USER.Output.Compressor1 == "TOGGLE_VALUE_OFFON_1"
  - Name: "Compressor 1"
```

#### 9. Occupancy Sensor (Compressor 2 Running)
```
Service: OccupancySensor
Characteristics:
  - OccupancyDetected: _USER.Output.Compressor2 == "TOGGLE_VALUE_OFFON_1"
  - Name: "Compressor 2"
```

#### 10. Light Sensor (Capacity %) - Creative use
```
Service: LightSensor
Characteristics:
  - CurrentAmbientLightLevel: Map 0-100% capacity to 1-100000 lux
  - Name: "Heat Pump Capacity"
```

## Plugin Architecture

### Directory Structure
```
homebridge-ies-heatpump/
├── src/
│   ├── index.ts              # Plugin entry point
│   ├── platform.ts           # Platform accessory handler
│   ├── api/
│   │   ├── client.ts         # HTTP client with cookie management
│   │   ├── auth.ts           # OIDC authentication handler
│   │   └── types.ts          # API response types
│   ├── accessories/
│   │   ├── thermostat.ts     # Thermostat accessory
│   │   ├── switch.ts         # Switch accessory
│   │   └── sensor.ts         # Temperature sensor accessory
│   └── utils/
│       └── parser.ts         # Parse API responses
├── config.schema.json        # Homebridge config UI schema
├── package.json
├── tsconfig.json
└── README.md
```

### Configuration Schema

```json
{
  "platform": "IESHeatPump",
  "name": "IES Heat Pump",
  "auth": {
    "method": "cookies",
    "cookies": {
      "AspNetCore.CookiesC1": "...",
      "AspNetCore.CookiesC2": "..."
    }
  },
  "deviceId": "999",
  "pollingInterval": 60,
  "accessories": {
    "mainSwitch": true,
    "hotWaterThermostat": true,
    "flowTemperature": true,
    "returnTemperature": true,
    "hotWaterTank": true,
    "outdoorTemperature": false,
    "compressorStatus": false,
    "capacityIndicator": false
  }
}
```

### Key Implementation Notes

1. **Polling:** Poll monitoring endpoint every 60 seconds (configurable). Don't poll too frequently - this is a cloud service.

2. **CSRF Token:** Before any POST to `/Configurations/Save`, fetch the settings page HTML and extract the `__RequestVerificationToken` value.

3. **Cookie Refresh:** ASP.NET session cookies expire. Implement detection of 401/302 responses and prompt user to refresh cookies, or implement automated re-auth.

4. **Error Handling:** 
   - Handle device offline status (`deviceOnline: false` in response)
   - Handle invalid sensor readings (e.g., -69.6°C for missing outdoor sensor)
   - Graceful degradation if API unavailable

5. **Value Parsing:**
   - `actualValue` is always a string - parse to float/int as needed
   - Enum values are text keys like `TOGGLE_VALUE_OFFON_1` - map to booleans/numbers
   - Use `displayFormt` hint for decimal precision (FORM_10 = 1 decimal, FORM_100 = 2 decimals)

6. **Write Debouncing:** Debounce write operations to avoid hammering the API if user adjusts a slider rapidly.

## Testing Checklist

- [ ] Authentication flow works
- [ ] Can read monitoring data
- [ ] Can read settings data
- [ ] Can write settings (curve offset, hot water setpoint)
- [ ] HomeKit shows correct current temperatures
- [ ] HomeKit can toggle main switch
- [ ] HomeKit can adjust hot water setpoint
- [ ] Handles device offline gracefully
- [ ] Handles session expiry gracefully
- [ ] Polling doesn't cause rate limiting

## Future Enhancements

1. **Mobile app client_id discovery:** Find the iOS app's client_id to enable username/password authentication instead of cookie-based auth.

2. **Local API investigation:** The heat pump uses an ESP32 chip - there may be a local Modbus or REST API that bypasses the cloud entirely.

3. **Historical data:** The web UI may have historical/charting endpoints that could be useful for HomeKit Controller apps.

4. **Push notifications:** Investigate if there's a WebSocket or Server-Sent Events endpoint for real-time updates instead of polling.

## Reference

- **Web UI:** https://www.ies-heatpumps.com
- **Login:** https://login.ies-heatpumps.com
- **OpenID Config:** https://login.ies-heatpumps.com/.well-known/openid-configuration
- **Device ID:** 999 (specific to user's installation)
- **Product ID:** 01956d8a-bf5a-4675-b76a-720322a0d06d
