'use strict';

class BillingAdapter {
  transition() { throw new Error('BillingAdapter.transition must be implemented.'); }
}

class LocalNoChargeBillingAdapter extends BillingAdapter {
  constructor() { super(); this.id = 'local-no-charge'; this.chargesCreated = 0; }
  transition({ nextState }) {
    return { state: nextState, externalReference: null, charged: false, invoice: null, tax: null, refund: null };
  }
}

class DeploymentAdapter {
  activeRegion() { throw new Error('DeploymentAdapter.activeRegion must be implemented.'); }
  markUnavailable() { throw new Error('DeploymentAdapter.markUnavailable must be implemented.'); }
}

class LocalDeploymentAdapter extends DeploymentAdapter {
  constructor(primary = 'local-1', fallback = 'local-2') {
    super();
    this.id = 'local';
    this.primary = primary;
    this.fallback = fallback;
    this.unavailable = new Set();
  }
  activeRegion() {
    if (!this.unavailable.has(this.primary)) return { region: this.primary, degraded: false };
    if (!this.unavailable.has(this.fallback)) return { region: this.fallback, degraded: true };
    return { region: null, degraded: true };
  }
  markUnavailable(region, unavailable = true) {
    if (unavailable) this.unavailable.add(region); else this.unavailable.delete(region);
    return this.activeRegion();
  }
}

class SecretProvider {
  getMasterKey() { throw new Error('SecretProvider.getMasterKey must be implemented.'); }
}

class EnvironmentSecretProvider extends SecretProvider {
  getMasterKey() {
    const value = process.env.ATHENA_CLOUD_MASTER_KEY_BASE64;
    if (!value) return null;
    const key = Buffer.from(value, 'base64');
    if (key.length !== 32) throw new Error('Environment master key must be 32 bytes.');
    return key;
  }
}

class RecoveryDeliveryAdapter {
  deliver() { throw new Error('RecoveryDeliveryAdapter.deliver must be implemented.'); }
}

class LocalRecoveryDeliveryAdapter extends RecoveryDeliveryAdapter {
  constructor() { super(); this.id = 'local-return-token'; }
  deliver({ token }) { return { delivered: true, localToken: token }; }
}

module.exports = {
  BillingAdapter, LocalNoChargeBillingAdapter, DeploymentAdapter, LocalDeploymentAdapter,
  SecretProvider, EnvironmentSecretProvider,
  RecoveryDeliveryAdapter, LocalRecoveryDeliveryAdapter,
};
