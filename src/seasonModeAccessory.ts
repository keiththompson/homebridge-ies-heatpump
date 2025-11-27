import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { IESHeatPumpPlatform } from './platform.js';

/**
 * Season Mode Switch Accessory
 * A single switch for one season mode option
 */
export class SeasonModeSwitchAccessory {
  private readonly service: Service;
  public readonly accessory: PlatformAccessory;
  public readonly modeValue: number;
  public readonly modeName: string;

  constructor(
    private readonly platform: IESHeatPumpPlatform,
    accessory: PlatformAccessory,
    modeValue: number,
    modeName: string,
    private readonly onSetMode: (mode: number) => Promise<void>,
    private readonly getCurrentMode: () => number,
  ) {
    this.accessory = accessory;
    this.modeValue = modeValue;
    this.modeName = modeName;

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'IES')
      .setCharacteristic(this.platform.Characteristic.Model, 'Season Mode')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, `season-${modeName.toLowerCase()}`);

    // Remove any old services that might be cached
    const oldThermostat = this.accessory.getService(this.platform.Service.Thermostat);
    if (oldThermostat) {
      this.accessory.removeService(oldThermostat);
    }

    // Get or create Switch service
    this.service = this.accessory.getService(this.platform.Service.Switch)
      || this.accessory.addService(this.platform.Service.Switch);

    this.service.setCharacteristic(this.platform.Characteristic.Name, modeName);

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getOn.bind(this))
      .onSet(this.setOn.bind(this));

    this.platform.log.debug(`Initialized Season Mode switch: ${modeName}`);
  }

  private async getOn(): Promise<CharacteristicValue> {
    return this.getCurrentMode() === this.modeValue;
  }

  private async setOn(value: CharacteristicValue): Promise<void> {
    const isOn = value as boolean;

    if (isOn) {
      // Turning this mode on
      if (this.getCurrentMode() !== this.modeValue) {
        this.platform.log.info(`Setting season mode to ${this.modeName}`);
        await this.onSetMode(this.modeValue);
      }
    } else {
      // Don't allow turning off the active mode - revert it
      if (this.getCurrentMode() === this.modeValue) {
        setTimeout(() => {
          this.service.updateCharacteristic(this.platform.Characteristic.On, true);
        }, 100);
      }
    }
  }

  /**
   * Update switch state based on current mode
   */
  updateState(currentMode: number): void {
    this.service.updateCharacteristic(
      this.platform.Characteristic.On,
      currentMode === this.modeValue,
    );
  }

  setUnavailable(): void {
    this.service.updateCharacteristic(
      this.platform.Characteristic.StatusFault,
      this.platform.Characteristic.StatusFault.GENERAL_FAULT,
    );
  }

  clearFault(): void {
    this.service.updateCharacteristic(
      this.platform.Characteristic.StatusFault,
      this.platform.Characteristic.StatusFault.NO_FAULT,
    );
  }
}
