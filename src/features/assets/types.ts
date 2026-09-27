import type { Schema } from '../../../amplify/data/resource';

export type Asset = Schema['Asset']['type'];
export type AssetVersion = Schema['AssetVersion']['type'];
export type AssetType = Schema['AssetType']['type'];
export type AssetCategory = Schema['AssetCategory']['type'];
export type AssetStatus = Schema['AssetStatus']['type'];
export type AssetSource = Schema['AssetSource']['type'];

export const ASSET_CATEGORIES: readonly AssetCategory[] = [
  'CHARACTER',
  'NPC',
  'CREATURE',
  'BUILDING',
  'PROP',
  'VEGETATION',
  'VEHICLE',
  'QUEST_ITEM',
  'ENVIRONMENT',
  'DECORATION',
  'OTHER',
];

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  CHARACTER: 'Character',
  NPC: 'NPC',
  CREATURE: 'Creature',
  BUILDING: 'Building',
  PROP: 'Prop',
  VEGETATION: 'Vegetation',
  VEHICLE: 'Vehicle',
  QUEST_ITEM: 'Quest item',
  ENVIRONMENT: 'Environment',
  DECORATION: 'Decoration',
  OTHER: 'Other',
};

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  DRAFT: 'Draft',
  PROCESSING: 'Processing',
  READY: 'Ready',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
  ERROR: 'Error',
};

export const ASSET_SOURCES: readonly AssetSource[] = [
  'THIRD_PARTY_PACK',
  'COMMISSIONED',
  'IN_HOUSE',
  'AI_TOOL',
  'OTHER',
];

export const ASSET_SOURCE_LABELS: Record<AssetSource, string> = {
  THIRD_PARTY_PACK: 'Third-party pack',
  COMMISSIONED: 'Commissioned artist',
  IN_HOUSE: 'Made in-house (Blender, scripts)',
  AI_TOOL: 'AI modeling tool',
  OTHER: 'Other',
};

/** Details the admin enters in the upload wizard's second step. */
export interface ModelAssetDetails {
  name: string;
  description: string;
  category: AssetCategory;
  worldId: string;
  regionId: string;
  source: AssetSource;
  sourceNotes: string;
}
