import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { TemperatureSensorAccessory } from './temperatureSensorAccessory.js';
import { HotWaterThermostatAccessory } from './hotWaterThermostatAccessory.js';
import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  TEMPERATURE_SENSORS,
  HOT_WATER_PARAMS,
  DEFAULT_POLLING_INTERVAL,
  MIN_POLLING_INTERVAL,
  SensorDefinition,
} from './settings.js';
import { IESClient } from './api/client.js';
import { IESApiError } from './api/types.js';

/**
 * Plugin configuration interface
 */
interface IESHeatPumpConfig extends PlatformConfig {
  deviceId?: string;
  cookies?: string;
  pollingInterval?: number;
}

/**
 * IES Heat Pump Platform
 * Main platform class that manages temperature sensor and thermostat accessories
 */
export class IESHeatPumpPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // Cached accessories from disk
  private readonly accessories: Map<string, PlatformAccessory> = new Map();

  // Active accessory handlers
  private readonly sensorAccessories: Map<string, TemperatureSensorAccessory> = new Map();
  private hotWaterThermostat?: HotWaterThermostatAccessory;

  // API client (initialized after config validation)
  private apiClient?: IESClient;

  // Polling timer
  private pollingTimer?: NodeJS.Timeout;

  // Track all registered UUIDs for cleanup
  private registeredUUIDs: string[] = [];

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.log.debug('Initializing IES Heat Pump platform');

    // Wait for Homebridge to finish loading cached accessories
    this.api.on('didFinishLaunching', () => {
      this.log.debug('didFinishLaunching callback');
      this.setupPlatform();
    });
  }

  /**
   * Called by Homebridge to restore cached accessories
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Restoring cached accessory:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * Main setup after Homebridge is ready
   */
  private async setupPlatform(): Promise<void> {
    const typedConfig = this.config as IESHeatPumpConfig;

    // Validate required config
    if (!typedConfig.deviceId) {
      this.log.error('Missing required config: deviceId. Please configure your device ID in the plugin settings.');
      return;
    }

    if (!typedConfig.cookies) {
      this.log.error('Missing required config: cookies. Please provide your session cookies in the plugin settings.');
      return;
    }

    // Initialize API client
    this.apiClient = new IESClient(
      {
        deviceId: typedConfig.deviceId,
        cookies: typedConfig.cookies,
      },
      this.log,
    );

    // Discover/register accessories
    this.discoverSensors();
    this.discoverHotWater();
    this.cleanupObsoleteAccessories();

    // Start polling
    const interval = Math.max(
      typedConfig.pollingInterval ?? DEFAULT_POLLING_INTERVAL,
      MIN_POLLING_INTERVAL,
    );
    this.startPolling(interval);

    // Do initial fetch
    await this.pollApi();
  }

  /**
   * Register temperature sensor accessories
   */
  private discoverSensors(): void {
    const typedConfig = this.config as IESHeatPumpConfig;

    for (const sensorDef of TEMPERATURE_SENSORS) {
      // Generate unique UUID from device ID + sensor paramId
      const uuid = this.api.hap.uuid.generate(
        `${typedConfig.deviceId}-${sensorDef.paramId}`,
      );
      this.registeredUUIDs.push(uuid);

      let accessory = this.accessories.get(uuid);

      if (accessory) {
        // Restore from cache
        this.log.info('Restoring sensor from cache:', sensorDef.name);
        accessory.context.sensorDefinition = sensorDef;
      } else {
        // Create new accessory
        this.log.info('Adding new sensor:', sensorDef.name);
        accessory = new this.api.platformAccessory(sensorDef.name, uuid);
        accessory.context.sensorDefinition = sensorDef;
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      // Create handler
      const handler = new TemperatureSensorAccessory(this, accessory);
      this.sensorAccessories.set(sensorDef.paramId, handler);
    }
  }

  /**
   * Register hot water thermostat accessory
   */
  private discoverHotWater(): void {
    const typedConfig = this.config as IESHeatPumpConfig;

    // Generate unique UUID for hot water thermostat
    const uuid = this.api.hap.uuid.generate(
      `${typedConfig.deviceId}-hot-water-thermostat`,
    );
    this.registeredUUIDs.push(uuid);

    let accessory = this.accessories.get(uuid);

    if (accessory) {
      // Restore from cache
      this.log.info('Restoring Hot Water thermostat from cache');
    } else {
      // Create new accessory
      this.log.info('Adding new Hot Water thermostat');
      accessory = new this.api.platformAccessory('Hot Water', uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    // Create handler
    this.hotWaterThermostat = new HotWaterThermostatAccessory(this, accessory);
  }

  /**
   * Remove any cached accessories that are no longer defined
   */
  private cleanupObsoleteAccessories(): void {
    for (const [uuid, accessory] of this.accessories) {
      if (!this.registeredUUIDs.includes(uuid)) {
        this.log.info('Removing obsolete accessory:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

  /**
   * Start the polling timer
   */
  private startPolling(intervalSeconds: number): void {
    this.log.info(`Starting API polling every ${intervalSeconds} seconds`);

    this.pollingTimer = setInterval(
      () => this.pollApi(),
      intervalSeconds * 1000,
    );
  }

  /**
   * Fetch data from API and update accessories
   */
  private async pollApi(): Promise<void> {
    if (!this.apiClient) {
      return;
    }

    try {
      const readings = await this.apiClient.fetchReadings();

      // Update temperature sensors
      for (const [paramId, handler] of this.sensorAccessories) {
        const reading = readings.get(paramId);
        const sensorDef = handler.accessory.context.sensorDefinition as SensorDefinition;

        if (reading) {
          // Check auto-hide threshold (for outdoor temp)
          if ('autoHideThreshold' in sensorDef &&
              sensorDef.autoHideThreshold !== undefined &&
              reading.value < sensorDef.autoHideThreshold) {
            this.log.debug(
              `Sensor ${sensorDef.name} showing invalid reading: ${reading.value}°C (below threshold ${sensorDef.autoHideThreshold}°C)`,
            );
          }

          handler.clearFault();
          handler.updateTemperature(reading.value);
        } else {
          this.log.warn(`No reading found for sensor: ${paramId}`);
        }
      }

      // Update hot water thermostat
      if (this.hotWaterThermostat) {
        // Current temperature
        const currentTemp = readings.get(HOT_WATER_PARAMS.currentTemp);
        if (currentTemp) {
          this.hotWaterThermostat.clearFault();
          this.hotWaterThermostat.updateCurrentTemperature(currentTemp.value);
        }

        // Setpoint (target temperature)
        const setpoint = readings.get(HOT_WATER_PARAMS.setpoint);
        if (setpoint) {
          this.hotWaterThermostat.updateTargetTemperature(setpoint.value);
        }

        // Heating state
        const heatingState = readings.get(HOT_WATER_PARAMS.heatingState);
        if (heatingState) {
          // API returns string like "TOGGLE_VALUE_OFFON_1" for on
          const isHeating = heatingState.raw === 'TOGGLE_VALUE_OFFON_1';
          this.hotWaterThermostat.updateHeatingState(isHeating);
        }
      }

    } catch (error) {
      if (error instanceof IESApiError) {
        if (error.isAuthError) {
          this.log.error('Authentication failed - please update your cookies in the plugin config');
        } else {
          this.log.error(`API error: ${error.message}`);
        }

        // Mark all accessories as faulted
        for (const handler of this.sensorAccessories.values()) {
          handler.setUnavailable();
        }
        this.hotWaterThermostat?.setUnavailable();
      } else {
        this.log.error('Unexpected error during API poll:', error);
      }
    }
  }

  /**
   * Set hot water setpoint via API
   */
  async setHotWaterSetpoint(temperature: number): Promise<void> {
    if (!this.apiClient) {
      this.log.error('Cannot set hot water setpoint - API client not initialized');
      return;
    }

    try {
      await this.apiClient.setHotWaterSetpoint(temperature);
    } catch (error) {
      if (error instanceof IESApiError) {
        this.log.error(`Failed to set hot water setpoint: ${error.message}`);
      } else {
        this.log.error('Unexpected error setting hot water setpoint:', error);
      }
    }
  }
}
