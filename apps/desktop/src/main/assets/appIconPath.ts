import { join } from 'node:path';

/** Resolve a file under apps/desktop/resources (dev) or process.resourcesPath (packaged). */
export function appResourcePath(
  filename: string,
  dirname = import.meta.dirname,
  packaged = false,
  resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : '',
): string {
  if (packaged && resourcesPath) {
    return join(resourcesPath, filename);
  }
  // apps/desktop/src/main/assets -> apps/desktop/resources
  return join(dirname, '../../../resources', filename);
}
