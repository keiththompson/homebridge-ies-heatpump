import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { IESHeatPumpPlatform } from './platform.js';
import { COMPENSATION_TYPES } from './settings.js';

/**
 * Compensation Type Selector Accessory
 * Uses Television service with InputSource to create a dropdown-like selector
 */
export class CompensationTypeSelectorAccessory {
  private readonly tvService: Service;
  private readonly inputServices: Service[] = [];
  public readonly accessory: PlatformAccessory;

  private currentType = 0;

  constructor(
    private readonly platform: IESHeatPumpPlatform,
    accessory: PlatformAccessory,
    private readonly onSetType: (type: number) => Promise<void>,
  ) {
    this.accessory = accessory;

    // Set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'IES')
      .setCharacteristic(this.platform.Characteristic.Model, 'Compensation Type')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'comp-type-selector');

    // Remove any old Switch services that might be cached
    const oldSwitches = this.accessory.services.filter((s) => s.UUID === this.platform.Service.Switch.UUID);
    for (const oldSwitch of oldSwitches) {
      this.accessory.removeService(oldSwitch);
    }

    // Get or create Television service
    this.tvService =
      this.accessory.getService(this.platform.Service.Television) ||
      this.accessory.addService(this.platform.Service.Television);

    this.tvService
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, 'Compensation Type')
      .setCharacteristic(this.platform.Characteristic.Name, 'Compensation Type')
      .setCharacteristic(
        this.platform.Characteristic.SleepDiscoveryMode,
        this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
      );

    // Active characteristic (required but we'll keep it always "on")
    this.tvService
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => this.platform.Characteristic.Active.ACTIVE)
      .onSet(() => {
        // Ignore attempts to turn off - always stay active
      });

    // ActiveIdentifier is the selected input (0-7 for our compensation types)
    this.tvService
      .getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
      .onGet(this.getActiveIdentifier.bind(this))
      .onSet(this.setActiveIdentifier.bind(this));

    // Remove any old InputSource services
    const oldInputs = this.accessory.services.filter((s) => s.UUID === this.platform.Service.InputSource.UUID);
    for (const oldInput of oldInputs) {
      this.accessory.removeService(oldInput);
    }

    // Create InputSource for each compensation type
    for (const compType of COMPENSATION_TYPES) {
      const inputService = this.accessory.addService(
        this.platform.Service.InputSource,
        compType.name,
        compType.apiValue,
      );

      inputService
        .setCharacteristic(this.platform.Characteristic.Identifier, compType.value)
        .setCharacteristic(this.platform.Characteristic.ConfiguredName, compType.name)
        .setCharacteristic(this.platform.Characteristic.Name, compType.name)
        .setCharacteristic(
          this.platform.Characteristic.InputSourceType,
          this.platform.Characteristic.InputSourceType.OTHER,
        )
        .setCharacteristic(
          this.platform.Characteristic.IsConfigured,
          this.platform.Characteristic.IsConfigured.CONFIGURED,
        )
        .setCharacteristic(
          this.platform.Characteristic.CurrentVisibilityState,
          this.platform.Characteristic.CurrentVisibilityState.SHOWN,
        );

      // Link the input to the TV service
      this.tvService.addLinkedService(inputService);
      this.inputServices.push(inputService);
    }

    this.platform.log.debug('Initialized Compensation Type selector (Television service)');
  }

  private async getActiveIdentifier(): Promise<CharacteristicValue> {
    return this.currentType;
  }

  private async setActiveIdentifier(value: CharacteristicValue): Promise<void> {
    const newType = value as number;

    if (newType !== this.currentType) {
      const typeName = COMPENSATION_TYPES.find((t) => t.value === newType)?.name || 'Unknown';
      this.platform.log.info(`Setting compensation type to ${typeName} (${newType})`);
      this.currentType = newType;
      await this.onSetType(newType);
    }
  }

  /**
   * Update state from API
   */
  updateState(type: number): void {
    this.currentType = type;
    this.tvService.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, type);
  }

  setUnavailable(): void {
    // Television service doesn't have StatusFault, so we just log
    this.platform.log.debug('Compensation Type selector marked unavailable');
  }

  clearFault(): void {
    // No-op for Television service
  }
}
