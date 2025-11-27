import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { IESHeatPumpPlatform } from './platform.js';

/**
 * Season Mode Accessory
 * Exposes three switches for Summer/Winter/Auto selection
 * Only one can be active at a time (radio button behavior)
 */
export class SeasonModeAccessory {
  private readonly summerSwitch: Service;
  private readonly winterSwitch: Service;
  private readonly autoSwitch: Service;
  public readonly accessory: PlatformAccessory;

  // Current mode (0=Summer, 1=Winter, 2=Auto)
  private currentMode = 1;

  constructor(
    private readonly platform: IESHeatPumpPlatform,
    accessory: PlatformAccessory,
  ) {
    this.accessory = accessory;

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'IES')
      .setCharacteristic(this.platform.Characteristic.Model, 'Season Control')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'season-mode');

    // Remove any old Thermostat service if it exists
    const oldThermostat = this.accessory.getService(this.platform.Service.Thermostat);
    if (oldThermostat) {
      this.accessory.removeService(oldThermostat);
    }

    // Create three switch services with unique subtype IDs
    this.summerSwitch = this.accessory.getService('Summer')
      || this.accessory.addService(this.platform.Service.Switch, 'Summer', 'summer');
    this.summerSwitch.setCharacteristic(this.platform.Characteristic.Name, 'Summer');
    this.summerSwitch.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.currentMode === 0)
      .onSet(this.setSummer.bind(this));

    this.winterSwitch = this.accessory.getService('Winter')
      || this.accessory.addService(this.platform.Service.Switch, 'Winter', 'winter');
    this.winterSwitch.setCharacteristic(this.platform.Characteristic.Name, 'Winter');
    this.winterSwitch.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.currentMode === 1)
      .onSet(this.setWinter.bind(this));

    this.autoSwitch = this.accessory.getService('Auto')
      || this.accessory.addService(this.platform.Service.Switch, 'Auto', 'auto');
    this.autoSwitch.setCharacteristic(this.platform.Characteristic.Name, 'Auto');
    this.autoSwitch.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.currentMode === 2)
      .onSet(this.setAuto.bind(this));

    this.platform.log.debug('Initialized Season Mode accessory (3 switches)');
  }

  /**
   * Update mode from API
   * @param value Raw string value from API (e.g., "TXT_TGT_SEA_MODE1")
   */
  updateMode(value: string): void {
    // Parse the mode number from the API value
    const match = value.match(/MODE(\d)$/);
    if (match) {
      this.currentMode = parseInt(match[1], 10);
    }

    // Update all switch states
    this.summerSwitch.updateCharacteristic(
      this.platform.Characteristic.On,
      this.currentMode === 0,
    );
    this.winterSwitch.updateCharacteristic(
      this.platform.Characteristic.On,
      this.currentMode === 1,
    );
    this.autoSwitch.updateCharacteristic(
      this.platform.Characteristic.On,
      this.currentMode === 2,
    );

    const modeName = ['Summer', 'Winter', 'Auto'][this.currentMode] || 'Unknown';
    this.platform.log.debug(`Season mode: ${modeName}`);
  }

  private async setSummer(value: CharacteristicValue): Promise<void> {
    if (value) {
      await this.setMode(0, 'Summer');
    } else if (this.currentMode === 0) {
      // Don't allow turning off the active mode - revert it
      setTimeout(() => {
        this.summerSwitch.updateCharacteristic(this.platform.Characteristic.On, true);
      }, 100);
    }
  }

  private async setWinter(value: CharacteristicValue): Promise<void> {
    if (value) {
      await this.setMode(1, 'Winter');
    } else if (this.currentMode === 1) {
      // Don't allow turning off the active mode - revert it
      setTimeout(() => {
        this.winterSwitch.updateCharacteristic(this.platform.Characteristic.On, true);
      }, 100);
    }
  }

  private async setAuto(value: CharacteristicValue): Promise<void> {
    if (value) {
      await this.setMode(2, 'Auto');
    } else if (this.currentMode === 2) {
      // Don't allow turning off the active mode - revert it
      setTimeout(() => {
        this.autoSwitch.updateCharacteristic(this.platform.Characteristic.On, true);
      }, 100);
    }
  }

  private async setMode(mode: number, name: string): Promise<void> {
    if (this.currentMode === mode) {
      return; // Already in this mode
    }

    this.platform.log.info(`Setting season mode to ${name}`);
    this.currentMode = mode;

    // Update UI immediately for responsiveness
    this.summerSwitch.updateCharacteristic(this.platform.Characteristic.On, mode === 0);
    this.winterSwitch.updateCharacteristic(this.platform.Characteristic.On, mode === 1);
    this.autoSwitch.updateCharacteristic(this.platform.Characteristic.On, mode === 2);

    await this.platform.setSeasonMode(mode);
  }

  /**
   * Mark as unavailable
   */
  setUnavailable(): void {
    const fault = this.platform.Characteristic.StatusFault.GENERAL_FAULT;
    this.summerSwitch.updateCharacteristic(this.platform.Characteristic.StatusFault, fault);
    this.winterSwitch.updateCharacteristic(this.platform.Characteristic.StatusFault, fault);
    this.autoSwitch.updateCharacteristic(this.platform.Characteristic.StatusFault, fault);
  }

  /**
   * Clear fault status
   */
  clearFault(): void {
    const noFault = this.platform.Characteristic.StatusFault.NO_FAULT;
    this.summerSwitch.updateCharacteristic(this.platform.Characteristic.StatusFault, noFault);
    this.winterSwitch.updateCharacteristic(this.platform.Characteristic.StatusFault, noFault);
    this.autoSwitch.updateCharacteristic(this.platform.Characteristic.StatusFault, noFault);
  }
}
