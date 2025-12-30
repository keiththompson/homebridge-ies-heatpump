import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { IESHeatPumpPlatform } from './platform.js';

/**
 * Compensation Type Switch Accessory
 * A single switch for one compensation type option
 */
export class CompensationTypeSwitchAccessory {
  private readonly service: Service;
  public readonly accessory: PlatformAccessory;
  public readonly typeValue: number;
  public readonly typeName: string;

  constructor(
    private readonly platform: IESHeatPumpPlatform,
    accessory: PlatformAccessory,
    typeValue: number,
    typeName: string,
    private readonly onSetType: (type: number) => Promise<void>,
    private readonly getCurrentType: () => number,
  ) {
    this.accessory = accessory;
    this.typeValue = typeValue;
    this.typeName = typeName;

    // Set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'IES')
      .setCharacteristic(this.platform.Characteristic.Model, 'Compensation Type')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, `comp-type-${typeValue}`);

    // Remove any old services that might be cached
    const oldThermostat = this.accessory.getService(this.platform.Service.Thermostat);
    if (oldThermostat) {
      this.accessory.removeService(oldThermostat);
    }

    // Get or create Switch service
    this.service =
      this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch);

    this.service.setCharacteristic(this.platform.Characteristic.Name, typeName);

    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getOn.bind(this))
      .onSet(this.setOn.bind(this));

    this.platform.log.debug(`Initialized Compensation Type switch: ${typeName}`);
  }

  private async getOn(): Promise<CharacteristicValue> {
    return this.getCurrentType() === this.typeValue;
  }

  private async setOn(value: CharacteristicValue): Promise<void> {
    const isOn = value as boolean;

    if (isOn) {
      // Turning this type on
      if (this.getCurrentType() !== this.typeValue) {
        this.platform.log.info(`Setting compensation type to ${this.typeName}`);
        await this.onSetType(this.typeValue);
      }
    } else {
      // Don't allow turning off the active type - revert it
      if (this.getCurrentType() === this.typeValue) {
        setTimeout(() => {
          this.service.updateCharacteristic(this.platform.Characteristic.On, true);
        }, 100);
      }
    }
  }

  /**
   * Update switch state based on current type
   */
  updateState(currentType: number): void {
    this.service.updateCharacteristic(this.platform.Characteristic.On, currentType === this.typeValue);
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
