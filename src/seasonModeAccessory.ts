import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { IESHeatPumpPlatform } from './platform.js';

/**
 * Season Mode Accessory
 * Exposes a HomeKit Thermostat service for switching between Summer/Winter/Auto modes
 * Uses TargetHeatingCoolingState: COOL=Summer, HEAT=Winter, AUTO=Auto
 */
export class SeasonModeAccessory {
  private readonly service: Service;
  public readonly accessory: PlatformAccessory;

  // Current mode (0=Summer, 1=Winter, 2=Auto)
  private currentMode = 1;

  // Map IES values to HomeKit states
  // IES: 0=Summer, 1=Winter, 2=Auto
  // HomeKit: HEAT=1, COOL=2, AUTO=3
  private readonly iesToHomeKit: Record<number, number>;
  private readonly homeKitToIes: Record<number, number>;

  constructor(
    private readonly platform: IESHeatPumpPlatform,
    accessory: PlatformAccessory,
  ) {
    this.accessory = accessory;

    // Build mapping tables
    const { HEAT, COOL, AUTO } = this.platform.Characteristic.TargetHeatingCoolingState;
    this.iesToHomeKit = {
      0: COOL,   // Summer
      1: HEAT,   // Winter
      2: AUTO,   // Auto
    };
    this.homeKitToIes = {
      [COOL]: 0,   // Summer
      [HEAT]: 1,   // Winter
      [AUTO]: 2,   // Auto
    };

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'IES')
      .setCharacteristic(this.platform.Characteristic.Model, 'Season Control')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'season-mode');

    // Get or create Thermostat service
    this.service = this.accessory.getService(this.platform.Service.Thermostat)
      || this.accessory.addService(this.platform.Service.Thermostat);

    // Set display name
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Season Mode');

    // Configure Current Temperature (not really used, but required)
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .setProps({
        minValue: 0,
        maxValue: 50,
      });

    // Configure Target Temperature (not really used, but required - set to fixed value)
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({
        minValue: 10,
        maxValue: 38,
        minStep: 1,
      });

    // Set a fixed target temperature since we're not using it
    this.service.updateCharacteristic(
      this.platform.Characteristic.TargetTemperature,
      20,
    );

    // Configure heating/cooling states - this is what we actually use
    // Summer = COOL, Winter = HEAT, Auto = AUTO
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .setProps({
        validValues: [HEAT, COOL],
      });

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [HEAT, COOL, AUTO],
      })
      .onGet(this.getTargetState.bind(this))
      .onSet(this.setTargetState.bind(this));

    this.platform.log.debug('Initialized Season Mode accessory');
  }

  /**
   * Update mode from API
   * @param value Raw string value from API (e.g., "TXT_TGT_SEA_MODE1")
   */
  updateMode(value: string): void {
    // Parse the mode number from the API value
    // Format: "TXT_TGT_SEA_MODE0" = 0 (Summer), "TXT_TGT_SEA_MODE1" = 1 (Winter), etc.
    const match = value.match(/MODE(\d)$/);
    if (match) {
      this.currentMode = parseInt(match[1], 10);
    }

    const homeKitTarget = this.iesToHomeKit[this.currentMode];
    const homeKitCurrent = this.currentMode === 2
      ? this.platform.Characteristic.CurrentHeatingCoolingState.OFF // Auto shows as OFF for current
      : (this.currentMode === 0
        ? this.platform.Characteristic.CurrentHeatingCoolingState.COOL
        : this.platform.Characteristic.CurrentHeatingCoolingState.HEAT);

    this.service.updateCharacteristic(
      this.platform.Characteristic.TargetHeatingCoolingState,
      homeKitTarget,
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.CurrentHeatingCoolingState,
      homeKitCurrent,
    );

    const modeName = ['Summer', 'Winter', 'Auto'][this.currentMode] || 'Unknown';
    this.platform.log.debug(`Season mode: ${modeName} (${this.currentMode})`);
  }

  /**
   * Get target state for HomeKit
   */
  private async getTargetState(): Promise<CharacteristicValue> {
    return this.iesToHomeKit[this.currentMode];
  }

  /**
   * Set target state from HomeKit
   */
  private async setTargetState(value: CharacteristicValue): Promise<void> {
    const homeKitState = value as number;
    const iesMode = this.homeKitToIes[homeKitState];

    if (iesMode === undefined) {
      this.platform.log.warn(`Unknown HomeKit state: ${homeKitState}`);
      return;
    }

    const modeName = ['Summer', 'Winter', 'Auto'][iesMode];
    this.platform.log.info(`Setting season mode to ${modeName}`);

    this.currentMode = iesMode;
    await this.platform.setSeasonMode(iesMode);
  }

  /**
   * Mark as unavailable
   */
  setUnavailable(): void {
    this.service.updateCharacteristic(
      this.platform.Characteristic.StatusFault,
      this.platform.Characteristic.StatusFault.GENERAL_FAULT,
    );
  }

  /**
   * Clear fault status
   */
  clearFault(): void {
    this.service.updateCharacteristic(
      this.platform.Characteristic.StatusFault,
      this.platform.Characteristic.StatusFault.NO_FAULT,
    );
  }
}
