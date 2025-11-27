/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'IESHeatPump';

/**
 * This must match the name of your plugin as defined the package.json `name` property
 */
export const PLUGIN_NAME = 'homebridge-ies-heatpump';

/**
 * Default polling interval in seconds
 */
export const DEFAULT_POLLING_INTERVAL = 60;

/**
 * Minimum allowed polling interval in seconds
 */
export const MIN_POLLING_INTERVAL = 30;

/**
 * Temperature sensor definitions mapping API paramIds to HomeKit accessories
 */
export const TEMPERATURE_SENSORS = [
  {
    paramId: '_USER.Input.Tamb',
    name: 'Outdoor Temperature',
    subtypeId: 'outdoor-temp',
    autoHideThreshold: -40, // Hide if value below this (indicates sensor not installed)
  },
] as const;

/**
 * Hot Water Thermostat parameter IDs
 */
export const HOT_WATER_PARAMS = {
  currentTemp: '_USER.Input.TWaterTank',
  setpoint: '_USER.HotWater.SetPoint',
  heatingState: '_USER.Output.HotTapWater',
} as const;

/**
 * Curve Offset parameter ID (heating curve temperature offset)
 * Range: -10 to +10°C, whole numbers only
 */
export const CURVE_OFFSET_PARAM = '_USER.HeatSPCtrl.ToffSet' as const;

/**
 * Heating Room Setpoint parameter ID
 * Range: 5 to 40°C, whole numbers only
 */
export const HEATING_ROOM_SETPOINT_PARAM = '_USER.HeatSPCtrl.TroomSet' as const;

/**
 * Season Mode parameter ID
 * Values: 0 = Summer, 1 = Winter, 2 = Auto
 */
export const SEASON_MODE_PARAM = '_USER.Parameters.SeasonMode' as const;

export type SensorDefinition = typeof TEMPERATURE_SENSORS[number];
