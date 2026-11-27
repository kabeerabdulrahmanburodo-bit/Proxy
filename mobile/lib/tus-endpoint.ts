const TUS_UPLOAD_PATH = "/storage/v1/upload/resumable";

/**
 * Resolve the Supabase resumable-upload endpoint.
 *
 * Hosted Supabase projects use the dedicated Storage hostname. Local and
 * self-hosted installations keep their configured origin and port.
 */
export function resolveTusEndpoint(configuredUrl: string): string {
  let projectUrl: URL;
  try {
    projectUrl = new URL(configuredUrl);
  } catch {
    throw new Error("EXPO_PUBLIC_SUPABASE_URL must be a valid absolute URL.");
  }

  if (projectUrl.protocol !== "https:" && projectUrl.protocol !== "http:") {
    throw new Error("EXPO_PUBLIC_SUPABASE_URL must use HTTP or HTTPS.");
  }

  const hostedProject = projectUrl.protocol === "https:" && !projectUrl.port
    ? projectUrl.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i)
    : null;
  const storageOrigin = hostedProject
    ? "https://" + hostedProject[1] + ".storage.supabase.co"
    : projectUrl.origin;

  return new URL(TUS_UPLOAD_PATH, storageOrigin).toString();
}
