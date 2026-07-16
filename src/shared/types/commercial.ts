export type CommercialReleaseStage = 'prelaunch' | 'production';
export type LicenseProviderMode = 'unconfigured' | 'test' | 'production';
export type LicenseStatus = 'inactive' | 'active' | 'invalid' | 'revoked';

export interface DesktopCommercialPolicy {
  schemaVersion: 1;
  releaseStage: CommercialReleaseStage;
  product: {
    name: string;
    skuId: string;
    displayName: string;
    licenseModel: 'one_time';
    accountRequired: false;
    maxActiveDevices: number;
    includedMajorVersion: number;
    freeTier: false;
    subscription: false;
    price: number | null;
    currency: string | null;
  };
  transfer: {
    selfServiceDeactivationRequired: true;
    lostDeviceRecovery: 'support_review';
    annualSupportResetLimit: number;
  };
  refund: {
    requestWindowDays: number;
    statutoryRightsOverride: true;
    licenseRevokedAfterRefund: true;
    localDataPreserved: true;
  };
  provider: {
    mode: LicenseProviderMode;
    paymentAdapter: string | null;
    licenseAdapter: string | null;
    activationBaseUrl: string | null;
    verificationPublicKey: string | null;
  };
  identity: {
    legalEntity: string | null;
    websiteBaseUrl: string | null;
    supportUrl: string | null;
    supportEmail: string | null;
    privacyEmail: string | null;
    securityEmail: string | null;
  };
}

export interface LicenseEntitlement {
  schemaVersion: 1;
  entitlementId: string;
  skuId: string;
  deviceId: string;
  includedMajorVersion: number;
  issuedAt: string;
  status: 'active' | 'revoked';
  verificationToken: string;
}

export interface LicenseActivationRequest {
  licenseKey: string;
  deviceId: string;
  appVersion: string;
  skuId: string;
}

export interface LicenseAdapter {
  readonly id: string;
  readonly mode: Exclude<LicenseProviderMode, 'unconfigured'>;
  activate(request: LicenseActivationRequest): Promise<LicenseEntitlement>;
  deactivate(entitlement: LicenseEntitlement): Promise<void>;
  verify(entitlement: LicenseEntitlement, deviceId: string): Promise<boolean>;
}

export interface LicenseStore {
  load(): Promise<LicenseEntitlement | null>;
  save(entitlement: LicenseEntitlement): Promise<void>;
  clear(): Promise<void>;
}

export interface LicenseState {
  status: LicenseStatus;
  entitlement: LicenseEntitlement | null;
  reason?: string;
}
