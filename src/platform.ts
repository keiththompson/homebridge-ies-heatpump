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
import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  TEMPERATURE_SENSORS,
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
 * Main platform class that manages temperature sensor accessories
 */
export class IESHeatPumpPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // Cached accessories from disk
  private readonly accessories: Map<string, PlatformAccessory> = new Map();

  // Active accessory handlers
  private readonly sensorAccessories: Map<string, TemperatureSensorAccessory> = new Map();

  // API client (initialized after config validation)
  private apiClient?: IESClient;

  // Polling timer
  private pollingTimer?: NodeJS.Timeout;

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

    // Discover/register sensors
    this.discoverSensors();

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
    const registeredUUIDs: string[] = [];
    const typedConfig = this.config as IESHeatPumpConfig;

    for (const sensorDef of TEMPERATURE_SENSORS) {
      // Generate unique UUID from device ID + sensor paramId
      const uuid = this.api.hap.uuid.generate(
        `${typedConfig.deviceId}-${sensorDef.paramId}`,
      );
      registeredUUIDs.push(uuid);

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

    // Remove any cached accessories that are no longer defined
    for (const [uuid, accessory] of this.accessories) {
      if (!registeredUUIDs.includes(uuid)) {
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

      // Update each sensor with its reading
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
            // Still update with actual value so user can see it's not working
          }

          handler.clearFault();
          handler.updateTemperature(reading.value);
        } else {
          this.log.warn(`No reading found for sensor: ${paramId}`);
        }
      }

    } catch (error) {
      if (error instanceof IESApiError) {
        if (error.isAuthError) {
          this.log.error('Authentication failed - please update your cookies in the plugin config');
        } else {
          this.log.error(`API error: ${error.message}`);
        }

        // Mark all sensors as faulted
        for (const handler of this.sensorAccessories.values()) {
          handler.setUnavailable();
        }
      } else {
        this.log.error('Unexpected error during API poll:', error);
      }
    }
  }
}
