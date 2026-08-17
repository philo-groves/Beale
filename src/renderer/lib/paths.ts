export function compactUserPath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const homePrefixPatterns = [
    /^[a-z]:\/Users\/(?!Public(?:\/|$)|Default(?: User)?(?:\/|$)|All Users(?:\/|$))[^/]+(?=\/|$)/iu,
    /^\/Users\/[^/]+(?=\/|$)/u,
    /^\/home\/[^/]+(?=\/|$)/u,
    /^\/root(?=\/|$)/u
  ];
  const homePrefix = homePrefixPatterns.find((pattern) => pattern.test(normalized));
  if (!homePrefix) return value;
  const relativePath = normalized.replace(homePrefix, '').replace(/^\/+/, '');
  return relativePath ? `~/${relativePath}` : '~/';
}
