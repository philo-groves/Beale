export function displayProgramHeaderName(programName: string | null | undefined): string {
  const normalized = (programName ?? '').trim().replace(/\s+/g, ' ');
  if (!normalized) return 'No Program Selected';
  return normalized
    .split(/(\s+)/)
    .map((part) => (part.trim() ? titleCaseProgramPart(part) : part))
    .join('');
}

function titleCaseProgramPart(value: string): string {
  return value
    .split(/([-_/])/)
    .map((part) => {
      if (!part || /^[-_/]$/.test(part)) return part;
      return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
    })
    .join('');
}
