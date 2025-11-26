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
    paramId: '_USER.Input.THeatSupply',
    name: 'Flow Temperature',
    subtypeId: 'flow-temp',
  },
  {
    paramId: '_USER.Input.THeatReturn',
    name: 'Return Temperature',
    subtypeId: 'return-temp',
  },
  {
    paramId: '_USER.Input.TWaterTank',
    name: 'Hot Water Tank',
    subtypeId: 'water-tank',
  },
  {
    paramId: '_USER.Input.Tamb',
    name: 'Outdoor Temperature',
    subtypeId: 'outdoor-temp',
    autoHideThreshold: -40, // Hide if value below this (indicates sensor not installed)
  },
] as const;

export type SensorDefinition = typeof TEMPERATURE_SENSORS[number];
