export function getSnapStoragePath(
  mediaUrl: string,
  userId: string,
  supabaseUrl: string,
): string | null {
  if (!mediaUrl || !userId || !supabaseUrl) return null;

  let objectPath = mediaUrl;

  if (mediaUrl.startsWith("https://") || mediaUrl.startsWith("http://")) {
    let media: URL;
    let project: URL;
    try {
      media = new URL(mediaUrl);
      project = new URL(supabaseUrl);
    } catch {
      return null;
    }

    if (media.origin !== project.origin) return null;

    const signedObjectPrefix = "/storage/v1/object/sign/snaps/";
    if (!media.pathname.startsWith(signedObjectPrefix)) return null;

    try {
      objectPath = decodeURIComponent(media.pathname.slice(signedObjectPrefix.length));
    } catch {
      return null;
    }
  } else if (
    mediaUrl.includes("://") ||
    mediaUrl.startsWith("/") ||
    mediaUrl.includes("?") ||
    mediaUrl.includes("#")
  ) {
    return null;
  }

  const parts = objectPath.split("/");
  if (parts.length !== 2 || parts[0] !== userId) return null;

  const fileName = parts[1];
  if (
    fileName === "." ||
    fileName === ".." ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,250}$/.test(fileName)
  ) {
    return null;
  }

  return objectPath;
}
