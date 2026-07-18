export interface MicrosoftStoreProductConfig {
  schemaVersion: 1;
  releaseStage: 'private-beta-draft' | 'private-beta' | 'production';
  skuId: 'athena-microsoft-store-private-beta-v1';
  productName: string;
  storeId: string;
  identityName: string;
  publisher: string;
  publisherDisplayName: string;
  packageFamilyName: string;
  audience: 'private' | 'public';
  supportedPlatforms: ['windows-x64'];
  updatesManagedBy: 'microsoft-store';
  externalPayments: false;
}

export interface MicrosoftStoreRuntimeConfig {
  schemaVersion: 1;
  skuId: 'athena-microsoft-store-private-beta-v1';
  storeId: string;
  identityName: string;
  packageFamilyName: string;
  audience: 'private';
  updatesManagedBy: 'microsoft-store';
  storePackageVersion: string;
  generatedAt: string;
}
