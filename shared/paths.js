/**
 * Upload path conventions, shared by the server (storage) and the browser
 * (live "will be saved to …" hint in the media panel).
 *
 *   YYYY/MM/ProjectName   e.g. 2026/11/Spring-Newsletter
 */

/** "Spring Newsletter 2026!" → "Spring-Newsletter-2026" (safe single path segment). */
export function sanitizeProjectName(name) {
  const cleaned = String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 64);
  return cleaned || 'Untitled';
}

/** Dynamic relative directory for a project at a given date: "2026/11/ProjectName". */
export function datedProjectDir(projectName, date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}/${mm}/${sanitizeProjectName(projectName)}`;
}
