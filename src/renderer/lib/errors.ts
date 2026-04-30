export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function userFacingErrorMessage(error: unknown): string {
  const message = errorMessage(error)
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();
  return message || 'An unknown error occurred.';
}
