// The Seed data's fixed IDs and values, in a module of their own that imports nothing, so
// the `ui` script's route manifest (scripts/ui/routes.ts), which Node runs
// straight from TypeScript, can build concrete paths to the seeded screens.

/** The Seed data's fixed IDs, for building concrete paths to its screens. None yet. */
export const SEED_IDS = {} as const;

/**
 * The seed User's Timezone. The `ui` script pins its browser to the same zone,
 * so the Settings page never shows the mismatch hint in its shots.
 */
export const SEED_TIMEZONE = "Europe/Warsaw";
