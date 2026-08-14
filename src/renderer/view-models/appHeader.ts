export function displayWorkspaceHeaderName(workspaceName: string | null | undefined): string {
  const normalized = (workspaceName ?? '').trim().replace(/\s+/g, ' ');
  if (!normalized) return 'No Workspace Selected';
  return normalized
    .split(/(\s+)/)
    .map((part) => (part.trim() ? titleCaseWorkspacePart(part) : part))
    .join('');
}

export function displayBreakoutRoomTitle(title: string | null | undefined): string {
  const normalized = (title ?? '').trim().replace(/\s+/g, ' ');
  if (!normalized) return 'Breakout Room';
  return normalized
    .split(/(\s+)/)
    .map((part) => (part.trim() ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join('');
}

function titleCaseWorkspacePart(value: string): string {
  return value
    .split(/([-_/])/)
    .map((part) => {
      if (!part || /^[-_/]$/.test(part)) return part;
      return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
    })
    .join('');
}
