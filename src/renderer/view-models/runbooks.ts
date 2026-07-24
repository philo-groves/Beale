export function runbookDescriptionText(value: string): string {
  return value
    .replace(/[ \t]*(?:\r\n|\r|\n)[ \t]*/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}
