export type SteamCloudApprovalStatus = 'not-approved' | 'approved';

export interface SteamCloudWhitelistEntry {
  id: string;
  relativePath: string;
  remoteName: string;
  maxBytes: number;
  containsPersonalData: boolean;
}

export interface SteamProductConfig {
  schemaVersion: 1;
  releaseStage: 'blocked' | 'candidate' | 'production';
  skuId: 'athena-steam-personal-v1';
  displayName: string;
  appId: number | null;
  depotId: number | null;
  launchExecutable: 'AthenaSteam.exe';
  testBranch: string;
  supportedPlatforms: ['windows-x64'];
  externalPayments: false;
  excludedCapabilities: Array<'full-execute' | 'terminal' | 'arbitrary-http' | 'external-payments'>;
  cloud: {
    enabled: boolean;
    approval: {
      window: '03';
      status: SteamCloudApprovalStatus;
      approvedAt: string | null;
      evidence: string | null;
    };
    maxTotalBytes: number;
    maxFileBytes: number;
    tombstoneRetentionDays: number;
    entries: SteamCloudWhitelistEntry[];
  };
}

export interface SteamRuntimeConfig {
  schemaVersion: 1;
  skuId: 'athena-steam-personal-v1';
  appId: number;
  depotId: number;
  buildBranch: string;
  cloudEnabled: boolean;
  generatedAt: string;
}

export type SteamStartupStatus = 'not-steam' | 'ready' | 'relaunch-required' | 'blocked';

export interface SteamStartupState {
  status: SteamStartupStatus;
  sku: 'desktop-direct' | 'steam';
  appId?: number;
  steamId64?: string;
  branch?: string | null;
  reason?: string;
}
