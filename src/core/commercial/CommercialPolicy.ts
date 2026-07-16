import * as fs from 'fs';
import { resolveConfigFile } from '../runtime/Paths';
import type { DesktopCommercialPolicy } from '../../shared/types';

const REQUIRED_PRODUCTION_FIELDS: Array<[string, (policy: DesktopCommercialPolicy) => unknown]> = [
  ['provider.paymentAdapter', policy => policy.provider.paymentAdapter],
  ['provider.licenseAdapter', policy => policy.provider.licenseAdapter],
  ['provider.activationBaseUrl', policy => policy.provider.activationBaseUrl],
  ['provider.verificationPublicKey', policy => policy.provider.verificationPublicKey],
  ['identity.legalEntity', policy => policy.identity.legalEntity],
  ['identity.websiteBaseUrl', policy => policy.identity.websiteBaseUrl],
  ['identity.supportUrl', policy => policy.identity.supportUrl],
  ['identity.supportEmail', policy => policy.identity.supportEmail],
  ['identity.privacyEmail', policy => policy.identity.privacyEmail],
  ['identity.securityEmail', policy => policy.identity.securityEmail],
];

export function loadCommercialPolicy(): DesktopCommercialPolicy {
  const filePath = resolveConfigFile('commercial.json');
  if (!filePath) throw new Error('Commercial policy config/commercial.json is missing.');
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  assertCommercialPolicy(value);
  return value;
}

export function commercialProductionBlockers(policy: DesktopCommercialPolicy): string[] {
  const blockers = REQUIRED_PRODUCTION_FIELDS
    .filter(([, read]) => !read(policy))
    .map(([name]) => `${name} is not configured`);
  if (policy.releaseStage !== 'production') blockers.unshift('releaseStage is not production');
  if (policy.provider.mode !== 'production') blockers.unshift('provider.mode is not production');
  if (policy.product.price === null || !policy.product.currency) blockers.push('price and currency are not configured');
  return blockers;
}

export function assertCommercialPolicy(value: unknown): asserts value is DesktopCommercialPolicy {
  if (!isRecord(value)) throw new Error('Commercial policy must be an object.');
  if (value.schemaVersion !== 1) throw new Error('Unsupported commercial policy schema.');
  if (value.releaseStage !== 'prelaunch' && value.releaseStage !== 'production') {
    throw new Error('Commercial releaseStage must be prelaunch or production.');
  }
  const product = requireRecord(value.product, 'product');
  if (product.skuId !== 'athena-desktop-personal-v1') throw new Error('Desktop 1.0 SKU drift detected.');
  if (product.licenseModel !== 'one_time' || product.accountRequired !== false) {
    throw new Error('Desktop 1.0 must remain a one-time, account-free license.');
  }
  if (product.freeTier !== false || product.subscription !== false) {
    throw new Error('Desktop 1.0 must not introduce Free/Pro tiers or subscriptions.');
  }
  if (product.maxActiveDevices !== 2 || product.includedMajorVersion !== 1) {
    throw new Error('Desktop 1.0 device or major-version entitlement drift detected.');
  }
  const transfer = requireRecord(value.transfer, 'transfer');
  if (transfer.selfServiceDeactivationRequired !== true || transfer.lostDeviceRecovery !== 'support_review') {
    throw new Error('Desktop 1.0 transfer policy drift detected.');
  }
  const refund = requireRecord(value.refund, 'refund');
  if (refund.requestWindowDays !== 14 || refund.statutoryRightsOverride !== true
    || refund.licenseRevokedAfterRefund !== true || refund.localDataPreserved !== true) {
    throw new Error('Desktop 1.0 refund policy drift detected.');
  }
  const provider = requireRecord(value.provider, 'provider');
  if (!['unconfigured', 'test', 'production'].includes(String(provider.mode))) {
    throw new Error('Commercial provider mode is invalid.');
  }
  requireRecord(value.identity, 'identity');
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Commercial policy ${name} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
