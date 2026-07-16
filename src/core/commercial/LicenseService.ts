import type {
  DesktopCommercialPolicy,
  LicenseActivationRequest,
  LicenseAdapter,
  LicenseEntitlement,
  LicenseState,
  LicenseStore,
} from '../../shared/types';

export interface LicenseServiceOptions {
  allowTestAdapter?: boolean;
}

export class LicenseService {
  constructor(
    private readonly policy: DesktopCommercialPolicy,
    private readonly adapter: LicenseAdapter,
    private readonly store: LicenseStore,
    options: LicenseServiceOptions = {},
  ) {
    if (adapter.mode === 'test' && !options.allowTestAdapter) {
      throw new Error('Test license adapters require an explicit local-test opt-in.');
    }
    if (adapter.mode === 'production' && policy.provider.mode !== 'production') {
      throw new Error('Production license adapter cannot run while commercial provider mode is not production.');
    }
  }

  async activate(licenseKey: string, deviceId: string, appVersion: string): Promise<LicenseState> {
    const request = this.activationRequest(licenseKey, deviceId, appVersion);
    const entitlement = await this.adapter.activate(request);
    this.assertEntitlement(entitlement, deviceId);
    if (!await this.adapter.verify(entitlement, deviceId)) {
      throw new Error('License provider returned an unverifiable entitlement.');
    }
    await this.store.save(entitlement);
    return { status: 'active', entitlement };
  }

  async current(deviceId: string): Promise<LicenseState> {
    const entitlement = await this.store.load();
    if (!entitlement) return { status: 'inactive', entitlement: null };
    try {
      this.assertEntitlement(entitlement, deviceId);
    } catch (error) {
      return { status: 'invalid', entitlement, reason: error instanceof Error ? error.message : String(error) };
    }
    if (entitlement.status === 'revoked') return { status: 'revoked', entitlement };
    return await this.adapter.verify(entitlement, deviceId)
      ? { status: 'active', entitlement }
      : { status: 'invalid', entitlement, reason: 'Entitlement verification failed.' };
  }

  async deactivate(deviceId: string): Promise<LicenseState> {
    const state = await this.current(deviceId);
    if (!state.entitlement) return state;
    if (state.status === 'invalid') throw new Error(state.reason || 'Stored entitlement is invalid.');
    await this.adapter.deactivate(state.entitlement);
    await this.store.clear();
    return { status: 'inactive', entitlement: null };
  }

  private activationRequest(licenseKey: string, deviceId: string, appVersion: string): LicenseActivationRequest {
    const normalizedKey = licenseKey.trim();
    const normalizedDevice = deviceId.trim();
    if (normalizedKey.length < 8 || normalizedKey.length > 256) throw new Error('License key length is invalid.');
    if (normalizedDevice.length < 8 || normalizedDevice.length > 256) throw new Error('Device identifier length is invalid.');
    if (!/^1\./.test(appVersion)) throw new Error('This entitlement only covers Athena Desktop 1.x.');
    return {
      licenseKey: normalizedKey,
      deviceId: normalizedDevice,
      appVersion,
      skuId: this.policy.product.skuId,
    };
  }

  private assertEntitlement(entitlement: LicenseEntitlement, deviceId: string): void {
    if (entitlement.schemaVersion !== 1) throw new Error('Unsupported entitlement schema.');
    if (entitlement.skuId !== this.policy.product.skuId) throw new Error('Entitlement SKU does not match this product.');
    if (entitlement.includedMajorVersion !== this.policy.product.includedMajorVersion) {
      throw new Error('Entitlement major version does not match this product.');
    }
    if (entitlement.deviceId !== deviceId.trim()) throw new Error('Entitlement belongs to another device.');
    if (!entitlement.verificationToken) throw new Error('Entitlement verification token is missing.');
  }
}
