/** Product / package semver (Preview). */
export const APP_VERSION = '1.0.0-Preview';

/** Public GitHub repository (issues / source). */
export const GITHUB_REPO_URL = 'https://github.com/baofengbaofeng/Jarvis';

/** Config export/import payload schema — aligned with product version at 1.0.0-Preview. */
export const CONFIG_SCHEMA_VERSION = '1.0.0-Preview';

/**
 * Legacy numeric export schema (desktop DB migration era, ≤ v12).
 * Still accepted on import for files exported before 1.0.0-Preview.
 */
export const LEGACY_CONFIG_SCHEMA_VERSION = 12;

/** electron-builder `${version}` / installer artifact basename segment. */
export const INSTALLER_ARTIFACT_VERSION = APP_VERSION;

/** Expected installer filenames under `dist/` (no extension on pattern root). */
export const INSTALLER_ARTIFACTS = {
  winMsi: `Jarvis_${INSTALLER_ARTIFACT_VERSION}_x86.msi`,
  macDmgX64: `Jarvis_${INSTALLER_ARTIFACT_VERSION}_x64.dmg`,
  macDmgArm64: `Jarvis_${INSTALLER_ARTIFACT_VERSION}_arm64.dmg`,
} as const;
