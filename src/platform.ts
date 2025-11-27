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
import { CurveOffsetAccessory } from './curveOffsetAccessory.js';
import { HeatingRoomSetpointAccessory } from './heatingRoomSetpointAccessory.js';
import { SeasonModeSwitchAccessory } from './seasonModeAccessory.js';
import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  TEMPERATURE_SENSORS,
  HOT_WATER_PARAMS,
  CURVE_OFFSET_PARAM,
  HEATING_ROOM_SETPOINT_PARAM,
  SEASON_MODE_PARAM,
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
  private curveOffsetAccessory?: CurveOffsetAccessory;
  private heatingRoomSetpointAccessory?: HeatingRoomSetpointAccessory;
  private seasonModeSwitches: SeasonModeSwitchAccessory[] = [];
  private currentSeasonMode = 1; // 0=Summer, 1=Winter, 2=Auto

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
    this.discoverCurveOffset();
    this.discoverHeatingRoomSetpoint();
    this.discoverSeasonMode();
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
   * Register curve offset accessory
   */
  private discoverCurveOffset(): void {
    const typedConfig = this.config as IESHeatPumpConfig;

    // Generate unique UUID for curve offset
    const uuid = this.api.hap.uuid.generate(
      `${typedConfig.deviceId}-curve-offset`,
    );
    this.registeredUUIDs.push(uuid);

    let accessory = this.accessories.get(uuid);

    if (accessory) {
      // Restore from cache
      this.log.info('Restoring Curve Offset from cache');
    } else {
      // Create new accessory
      this.log.info('Adding new Curve Offset accessory');
      accessory = new this.api.platformAccessory('Curve Offset', uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    // Create handler
    this.curveOffsetAccessory = new CurveOffsetAccessory(this, accessory);
  }

  /**
   * Register heating room setpoint accessory
   */
  private discoverHeatingRoomSetpoint(): void {
    const typedConfig = this.config as IESHeatPumpConfig;

    // Generate unique UUID for heating room setpoint
    const uuid = this.api.hap.uuid.generate(
      `${typedConfig.deviceId}-heating-room-setpoint`,
    );
    this.registeredUUIDs.push(uuid);

    let accessory = this.accessories.get(uuid);

    if (accessory) {
      // Restore from cache
      this.log.info('Restoring Heating Room Setpoint from cache');
    } else {
      // Create new accessory
      this.log.info('Adding new Heating Room Setpoint accessory');
      accessory = new this.api.platformAccessory('Room Setpoint', uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    // Create handler
    this.heatingRoomSetpointAccessory = new HeatingRoomSetpointAccessory(this, accessory);
  }

  /**
   * Register season mode switches (3 separate accessories)
   */
  private discoverSeasonMode(): void {
    const typedConfig = this.config as IESHeatPumpConfig;

    const modes = [
      { value: 0, name: 'Summer Mode' },
      { value: 1, name: 'Winter Mode' },
      { value: 2, name: 'Auto Mode' },
    ];

    for (const mode of modes) {
      const uuid = this.api.hap.uuid.generate(
        `${typedConfig.deviceId}-season-${mode.name.toLowerCase().replace(' ', '-')}`,
      );
      this.registeredUUIDs.push(uuid);

      let accessory = this.accessories.get(uuid);

      if (accessory) {
        this.log.info(`Restoring ${mode.name} from cache`);
      } else {
        this.log.info(`Adding new ${mode.name} accessory`);
        accessory = new this.api.platformAccessory(mode.name, uuid);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      const handler = new SeasonModeSwitchAccessory(
        this,
        accessory,
        mode.value,
        mode.name,
        async (modeValue) => this.setSeasonMode(modeValue),
        () => this.currentSeasonMode,
      );

      this.seasonModeSwitches.push(handler);
    }
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

      // Update curve offset
      if (this.curveOffsetAccessory) {
        const offset = readings.get(CURVE_OFFSET_PARAM);
        if (offset) {
          this.curveOffsetAccessory.clearFault();
          this.curveOffsetAccessory.updateOffset(offset.value);
        }
      }

      // Update heating room setpoint
      if (this.heatingRoomSetpointAccessory) {
        const setpoint = readings.get(HEATING_ROOM_SETPOINT_PARAM);
        if (setpoint) {
          this.heatingRoomSetpointAccessory.clearFault();
          this.heatingRoomSetpointAccessory.updateSetpoint(setpoint.value);
        }
      }

      // Update season mode switches
      if (this.seasonModeSwitches.length > 0) {
        const mode = readings.get(SEASON_MODE_PARAM);
        if (mode) {
          // Parse the mode number from the API value (e.g., "TXT_TGT_SEA_MODE1" -> 1)
          const match = mode.raw.match(/MODE(\d)$/);
          if (match) {
            this.currentSeasonMode = parseInt(match[1], 10);
          }
          for (const sw of this.seasonModeSwitches) {
            sw.clearFault();
            sw.updateState(this.currentSeasonMode);
          }
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
        this.curveOffsetAccessory?.setUnavailable();
        this.heatingRoomSetpointAccessory?.setUnavailable();
        for (const sw of this.seasonModeSwitches) {
          sw.setUnavailable();
        }
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
      // Refresh values immediately after successful write
      await this.pollApi();
    } catch (error) {
      if (error instanceof IESApiError) {
        this.log.error(`Failed to set hot water setpoint: ${error.message}`);
      } else {
        this.log.error('Unexpected error setting hot water setpoint:', error);
      }
    }
  }

  /**
   * Set curve offset via API
   */
  async setCurveOffset(offset: number): Promise<void> {
    if (!this.apiClient) {
      this.log.error('Cannot set curve offset - API client not initialized');
      return;
    }

    try {
      await this.apiClient.setCurveOffset(offset);
      // Refresh values immediately after successful write
      await this.pollApi();
    } catch (error) {
      if (error instanceof IESApiError) {
        this.log.error(`Failed to set curve offset: ${error.message}`);
      } else {
        this.log.error('Unexpected error setting curve offset:', error);
      }
    }
  }

  /**
   * Set heating room setpoint via API
   */
  async setHeatingRoomSetpoint(temperature: number): Promise<void> {
    if (!this.apiClient) {
      this.log.error('Cannot set heating room setpoint - API client not initialized');
      return;
    }

    try {
      await this.apiClient.setHeatingRoomSetpoint(temperature);
      // Refresh values immediately after successful write
      await this.pollApi();
    } catch (error) {
      if (error instanceof IESApiError) {
        this.log.error(`Failed to set heating room setpoint: ${error.message}`);
      } else {
        this.log.error('Unexpected error setting heating room setpoint:', error);
      }
    }
  }

  /**
   * Set season mode via API
   * @param mode 0=Summer, 1=Winter, 2=Auto
   */
  async setSeasonMode(mode: number): Promise<void> {
    if (!this.apiClient) {
      this.log.error('Cannot set season mode - API client not initialized');
      return;
    }

    // Update local state and switches immediately for responsiveness
    this.currentSeasonMode = mode;
    for (const sw of this.seasonModeSwitches) {
      sw.updateState(mode);
    }

    try {
      await this.apiClient.setSeasonMode(mode);
      // Refresh values immediately after successful write
      await this.pollApi();
    } catch (error) {
      if (error instanceof IESApiError) {
        this.log.error(`Failed to set season mode: ${error.message}`);
      } else {
        this.log.error('Unexpected error setting season mode:', error);
      }
    }
  }
}
