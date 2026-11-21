export const ORPHAN_STAGED_FILE_GRACE_MS = 60 * 60 * 1000;

export function shouldDeleteOrphanedStagedFile(
  uri: string,
  referencedUris: ReadonlySet<string>,
  modifiedAt: number | null | undefined,
  now = Date.now(),
): boolean {
  if (referencedUris.has(uri)) return false;
  if (modifiedAt === null || modifiedAt === undefined || !Number.isFinite(modifiedAt)) return false;
  return modifiedAt <= now - ORPHAN_STAGED_FILE_GRACE_MS;
}

export function shouldRequireStagedFile(remoteObjectExists: boolean): boolean {
  return !remoteObjectExists;
}
