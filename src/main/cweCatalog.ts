import type { WeaknessMappingConfidence, WeaknessMappingInput, WeaknessMappingStatus } from '@shared/types';

export interface CweCatalogEntry {
  cweId: string;
  name: string;
  abstraction: string;
  status: string;
  description: string;
  parentIds: string[];
  viewIds: string[];
  mappingStatus: WeaknessMappingStatus;
}

export const DEFAULT_CWE_CATALOG_ID = 'mitre-cwe-view-1003-seed';
export const DEFAULT_CWE_SOURCE_URL = 'https://cwe.mitre.org/data/slices/1003.html';
export const DEFAULT_CWE_CATALOG_VERSION = 'bundled-view-1003-seed';

export const DEFAULT_CWE_CATALOG: readonly CweCatalogEntry[] = [
  entry('CWE-20', 'Improper Input Validation', 'class', 'stable', 'Product does not validate or incorrectly validates input.', [], ['1003'], 'discouraged'),
  entry('CWE-22', "Improper Limitation of a Pathname to a Restricted Directory ('Path Traversal')", 'base', 'stable', 'Path traversal allows files outside an intended directory to be accessed.', [], ['1003'], 'allowed'),
  entry('CWE-77', "Improper Neutralization of Special Elements used in a Command ('Command Injection')", 'class', 'stable', 'Command injection weakness family.', [], ['1003'], 'discouraged'),
  entry('CWE-78', "Improper Neutralization of Special Elements used in an OS Command ('OS Command Injection')", 'base', 'stable', 'OS command injection through unsafe command construction.', [], ['1003'], 'allowed'),
  entry('CWE-79', "Improper Neutralization of Input During Web Page Generation ('Cross-site Scripting')", 'base', 'stable', 'Cross-site scripting through unsafe web output.', [], ['1003'], 'allowed'),
  entry('CWE-89', "Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')", 'base', 'stable', 'SQL injection through unsafe query construction.', [], ['1003'], 'allowed'),
  entry('CWE-94', "Improper Control of Generation of Code ('Code Injection')", 'base', 'stable', 'Code injection through unsafe generation or evaluation.', [], ['1003'], 'allowed'),
  entry('CWE-125', 'Out-of-bounds Read', 'base', 'stable', 'Reads memory outside the intended bounds.', [], ['1003'], 'allowed'),
  entry('CWE-200', 'Exposure of Sensitive Information to an Unauthorized Actor', 'class', 'stable', 'Sensitive information is exposed to an actor that should not receive it.', [], ['1003'], 'allowed'),
  entry('CWE-284', 'Improper Access Control', 'class', 'stable', 'Access control is missing or incorrectly enforced.', [], ['1003'], 'discouraged'),
  entry('CWE-287', 'Improper Authentication', 'class', 'stable', 'Authentication is missing or incorrectly implemented.', [], ['1003'], 'allowed'),
  entry('CWE-306', 'Missing Authentication for Critical Function', 'base', 'stable', 'A critical function lacks authentication.', [], ['1003'], 'allowed'),
  entry('CWE-352', 'Cross-Site Request Forgery (CSRF)', 'compound', 'stable', 'A web application accepts state-changing requests without sufficient CSRF protection.', [], ['1003'], 'allowed'),
  entry('CWE-400', 'Uncontrolled Resource Consumption', 'class', 'stable', 'Resource consumption can be forced beyond intended limits.', [], ['1003'], 'allowed'),
  entry('CWE-416', 'Use After Free', 'base', 'stable', 'Memory is used after it has been freed.', [], ['1003'], 'allowed'),
  entry('CWE-434', 'Unrestricted Upload of File with Dangerous Type', 'base', 'stable', 'Dangerous file uploads are accepted without sufficient restriction.', [], ['1003'], 'allowed'),
  entry('CWE-502', 'Deserialization of Untrusted Data', 'base', 'stable', 'Untrusted serialized data is deserialized unsafely.', [], ['1003'], 'allowed'),
  entry('CWE-611', 'Improper Restriction of XML External Entity Reference', 'base', 'stable', 'XML external entity processing is insufficiently restricted.', [], ['1003'], 'allowed'),
  entry('CWE-639', 'Authorization Bypass Through User-Controlled Key', 'base', 'stable', 'A user-controlled key can select or access resources across authorization boundaries.', [], ['1003'], 'allowed'),
  entry('CWE-770', 'Allocation of Resources Without Limits or Throttling', 'base', 'stable', 'Resources are allocated without effective limits.', [], ['1003'], 'allowed'),
  entry('CWE-787', 'Out-of-bounds Write', 'base', 'stable', 'Writes memory outside the intended bounds.', [], ['1003'], 'allowed'),
  entry('CWE-798', 'Use of Hard-coded Credentials', 'base', 'stable', 'Credentials are hard-coded into the product.', [], ['1003'], 'allowed'),
  entry('CWE-862', 'Missing Authorization', 'base', 'stable', 'The product does not perform an authorization check when one is required.', [], ['1003'], 'allowed'),
  entry('CWE-863', 'Incorrect Authorization', 'base', 'stable', 'The product performs an authorization check incorrectly.', [], ['1003'], 'allowed'),
  entry('CWE-918', 'Server-Side Request Forgery (SSRF)', 'base', 'stable', 'Server-side request functionality can be abused to make unintended requests.', [], ['1003'], 'allowed'),
  entry('CWE-942', 'Permissive Cross-domain Policy with Untrusted Domains', 'base', 'stable', 'Cross-domain policy trusts untrusted domains.', [], ['1003'], 'allowed')
];

const CATALOG_BY_ID = new Map(DEFAULT_CWE_CATALOG.map((item) => [item.cweId, item]));

export function cweEntryForId(cweId: string): CweCatalogEntry | null {
  return CATALOG_BY_ID.get(cweId) ?? null;
}

export function normalizeCweId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  if (!raw || /^(unknown|none|null|n\/a|needs[_ -]?classification)$/i.test(raw)) return null;
  const cweMatch = raw.match(/^CWE-(\d{1,8})$/i);
  if (cweMatch) return `CWE-${cweMatch[1]}`;
  const numericMatch = raw.match(/^(\d{1,8})$/);
  return numericMatch ? `CWE-${numericMatch[1]}` : null;
}

export function normalizeCweConfidence(value: unknown, fallback: WeaknessMappingConfidence = 'low'): WeaknessMappingConfidence {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'high') return 'high';
  if (normalized === 'medium' || normalized === 'med') return 'medium';
  if (normalized === 'low') return 'low';
  return fallback;
}

export function normalizeCweMappingStatus(value: unknown, fallback: WeaknessMappingStatus = 'unknown'): WeaknessMappingStatus {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'allowed') return 'allowed';
  if (normalized === 'discouraged') return 'discouraged';
  if (normalized === 'prohibited') return 'prohibited';
  if (normalized === 'unknown') return 'unknown';
  return fallback;
}

export function inferCweMapping(input: { bugClass: string; title: string; descriptionMarkdown?: string; impactMarkdown?: string }): WeaknessMappingInput | null {
  const text = [input.bugClass, input.title, input.descriptionMarkdown ?? '', input.impactMarkdown ?? ''].join('\n').toLowerCase();
  const cweId = inferCweId(text);
  if (!cweId) return null;
  const entry = cweEntryForId(cweId);
  return {
    cweId,
    cweName: entry?.name,
    mappingRole: 'primary',
    mappingStatus: entry?.mappingStatus ?? 'unknown',
    confidence: 'medium',
    rationaleMarkdown: 'Inferred from the Beale bug class, title, and impact text.',
    source: 'system'
  };
}

function inferCweId(text: string): string | null {
  if (/\b(idor|user[-_ ]controlled key|object id|tenant id|resource id)\b/.test(text)) return 'CWE-639';
  if (/\b(missing auth|missing authorization|no authorization|unauthori[sz]ed access)\b/.test(text)) return 'CWE-862';
  if (/\b(authz|authorization|access control|permission|tenant boundary|privilege)\b/.test(text)) return 'CWE-863';
  if (/\b(missing authentication|unauthenticated critical|no authentication)\b/.test(text)) return 'CWE-306';
  if (/\b(authentication|login|session fixation|credential validation)\b/.test(text)) return 'CWE-287';
  if (/\b(ssrf|server[-_ ]side request forgery)\b/.test(text)) return 'CWE-918';
  if (/\b(path traversal|directory traversal|zip slip|archive traversal)\b/.test(text)) return 'CWE-22';
  if (/\b(sql injection|sqli)\b/.test(text)) return 'CWE-89';
  if (/\b(os command|shell injection|command injection)\b/.test(text)) return 'CWE-78';
  if (/\b(code injection|eval injection|template injection)\b/.test(text)) return 'CWE-94';
  if (/\b(xss|cross[-_ ]site scripting)\b/.test(text)) return 'CWE-79';
  if (/\b(csrf|cross[-_ ]site request forgery)\b/.test(text)) return 'CWE-352';
  if (/\b(cors|cross[-_ ]domain policy)\b/.test(text)) return 'CWE-942';
  if (/\b(deseriali[sz]ation|untrusted serialized|pickle|objectinputstream)\b/.test(text)) return 'CWE-502';
  if (/\b(xxe|xml external entity)\b/.test(text)) return 'CWE-611';
  if (/\b(hardcoded credential|hard-coded credential|embedded credential|static credential)\b/.test(text)) return 'CWE-798';
  if (/\b(secret|token|credential|api key|information exposure|data exposure|leak)\b/.test(text)) return 'CWE-200';
  if (/\b(resource exhaustion|denial of service|dos|unbounded allocation|throttl)\b/.test(text)) return 'CWE-400';
  if (/\bout[-_ ]of[-_ ]bounds write|buffer overflow|heap overflow|stack overflow\b/.test(text)) return 'CWE-787';
  if (/\bout[-_ ]of[-_ ]bounds read|buffer overread|information disclosure read\b/.test(text)) return 'CWE-125';
  if (/\buse[-_ ]after[-_ ]free|uaf\b/.test(text)) return 'CWE-416';
  if (/\bfile upload|upload dangerous file|dangerous type\b/.test(text)) return 'CWE-434';
  if (/\binput validation|malformed input|parser confusion\b/.test(text)) return 'CWE-20';
  return null;
}

function entry(
  cweId: string,
  name: string,
  abstraction: string,
  status: string,
  description: string,
  parentIds: string[],
  viewIds: string[],
  mappingStatus: WeaknessMappingStatus
): CweCatalogEntry {
  return { cweId, name, abstraction, status, description, parentIds, viewIds, mappingStatus };
}
