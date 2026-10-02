export type LegacyStatus = "planned" | "unstarted" | "in-progress" | "finished";
export type LibraryPreferences = {
  schemaVersion: 2;
  favoriteIds: string[];
  playedRecentIds: string[];
  hiddenRecentIds: string[];
  queueIds: string[];
  wantToListenIds: string[];
  legacyStatusOverrides: Record<string, LegacyStatus>;
  dismissedLegacyIds: string[];
};
const ids = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length <= 200))] : [];

export function migrateLibraryPreferences(input: unknown): LibraryPreferences {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const legacy = value.legacyStatusOverrides ?? value.statusOverrides;
  const legacyStatusOverrides = Object.fromEntries(Object.entries(legacy && typeof legacy === "object" ? legacy : {}).filter(([, status]) => ["planned", "unstarted", "in-progress", "finished"].includes(String(status)))) as Record<string, LegacyStatus>;
  return {
    schemaVersion: 2,
    favoriteIds: ids(value.favoriteIds), playedRecentIds: ids(value.playedRecentIds), hiddenRecentIds: ids(value.hiddenRecentIds), queueIds: ids(value.queueIds),
    wantToListenIds: value.schemaVersion === 2 ? ids(value.wantToListenIds) : Object.keys(legacyStatusOverrides).filter(id => legacyStatusOverrides[id] === "planned"),
    legacyStatusOverrides, dismissedLegacyIds: ids(value.dismissedLegacyIds),
  };
}

export function mergeLibraryPreferences(previous: unknown, incoming: unknown) {
  const before = migrateLibraryPreferences(previous);
  const value = incoming && typeof incoming === "object" ? incoming as Record<string, unknown> : {};
  // Old clients can still edit pins/queue, but cannot undo migration or overwrite new fields.
  if (value.schemaVersion !== 2) return { ...before, ...Object.fromEntries(["favoriteIds", "playedRecentIds", "hiddenRecentIds", "queueIds"].filter(k => k in value).map(k => [k, ids(value[k])])) };
  return { ...migrateLibraryPreferences(value), legacyStatusOverrides: { ...migrateLibraryPreferences(value).legacyStatusOverrides, ...before.legacyStatusOverrides } };
}
