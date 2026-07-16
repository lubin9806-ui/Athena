import type { SteamRuntimeConfig, SteamStartupState } from '../../shared/types';
import { loadSteamRuntimeConfig } from './SteamSkuPolicy';

interface SteamworksClient {
  apps: {
    isSubscribed(): boolean;
    isSubscribedApp(appId: number): boolean;
    currentBetaName(): string | null;
  };
  localplayer: {
    getSteamId(): { steamId64: bigint | string };
  };
  utils: {
    getAppId(): number;
  };
  cloud: SteamCloudApi;
}

interface SteamworksModule {
  restartAppIfNecessary(appId: number): boolean;
  init(appId?: number): SteamworksClient;
}

export interface SteamCloudApi {
  isEnabledForAccount(): boolean;
  isEnabledForApp(): boolean;
  readFile(name: string): string;
  writeFile(name: string, content: string): boolean;
  deleteFile(name: string): boolean;
  fileExists(name: string): boolean;
  listFiles(): Array<{ name: string; size: bigint | number }>;
}

export interface SteamPlatformSession {
  state: SteamStartupState;
  runtime: SteamRuntimeConfig | null;
  cloud: SteamCloudApi | null;
}

export function initializeSteamPlatform(moduleOverride?: SteamworksModule): SteamPlatformSession {
  let runtime: SteamRuntimeConfig | null;
  try {
    runtime = loadSteamRuntimeConfig();
  } catch (error) {
    return blocked(null, `steam-runtime-config-invalid: ${errorMessage(error)}`);
  }

  if (!runtime) {
    return {
      state: { status: 'not-steam', sku: 'desktop-direct' },
      runtime: null,
      cloud: null,
    };
  }

  try {
    const steamworks = moduleOverride || loadSteamworksModule();
    if (steamworks.restartAppIfNecessary(runtime.appId)) {
      return {
        state: {
          status: 'relaunch-required',
          sku: 'steam',
          appId: runtime.appId,
          reason: 'Steam client relaunch requested.',
        },
        runtime,
        cloud: null,
      };
    }

    const client = steamworks.init(runtime.appId);
    const activeAppId = client.utils.getAppId();
    if (activeAppId !== runtime.appId) {
      return blocked(runtime, `steam-appid-mismatch expected=${runtime.appId} actual=${activeAppId}`);
    }
    if (!client.apps.isSubscribed() || !client.apps.isSubscribedApp(runtime.appId)) {
      return blocked(runtime, 'steam-ownership-check-failed');
    }

    const identity = client.localplayer.getSteamId();
    const steamId64 = String(identity.steamId64);
    if (!/^\d{16,20}$/.test(steamId64)) {
      return blocked(runtime, 'steam-user-identity-invalid');
    }
    const branch = client.apps.currentBetaName();
    if (runtime.buildBranch && runtime.buildBranch !== 'default' && branch !== runtime.buildBranch) {
      return blocked(runtime, `steam-branch-mismatch expected=${runtime.buildBranch} actual=${branch || 'default'}`);
    }

    return {
      state: {
        status: 'ready',
        sku: 'steam',
        appId: runtime.appId,
        steamId64,
        branch,
      },
      runtime,
      cloud: client.cloud,
    };
  } catch (error) {
    return blocked(runtime, `steamworks-initialization-failed: ${errorMessage(error)}`);
  }
}

export function describeSteamCloudAvailability(session: SteamPlatformSession): string {
  if (session.state.status !== 'ready' || !session.runtime || !session.cloud) return 'unavailable';
  if (!session.runtime.cloudEnabled) return 'disabled-by-athena-whitelist-policy';
  if (!session.cloud.isEnabledForAccount()) return 'disabled-by-steam-account';
  if (!session.cloud.isEnabledForApp()) return 'disabled-by-steam-app';
  return 'ready';
}

function loadSteamworksModule(): SteamworksModule {
  // Kept in the main process. The sandboxed renderer never receives the native module.
  return require('steamworks.js') as SteamworksModule;
}

function blocked(runtime: SteamRuntimeConfig | null, reason: string): SteamPlatformSession {
  return {
    state: {
      status: 'blocked',
      sku: 'steam',
      appId: runtime?.appId,
      reason,
    },
    runtime,
    cloud: null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
