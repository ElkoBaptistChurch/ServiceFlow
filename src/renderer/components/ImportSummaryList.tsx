import type { ImportError, ImportSummary } from '../../shared/types';

// Importers pass raw SQLite error text straight through as `reason` alongside their own
// hand-authored sentences (e.g. "song has no lyrics data"). A volunteer can't parse
// "NOT NULL constraint failed: bible_verses.text" -- flag it as technical rather than
// pretend it explains anything.
const RAW_SQLITE_TEXT = /constraint failed|no such (?:column|table)|SQLITE_/i;

export function describeSkipReason(reason: string): string {
  return RAW_SQLITE_TEXT.test(reason) ? `technical detail: ${reason}` : reason;
}

/** Per-file import results, shown inline in whichever library panel ran the import. */
export default function ImportSummaryList({ summary }: { summary: ImportSummary }) {
  return (
    <ul className="import-summary" aria-label="Import results">
      {summary.sources.map((s, i) => (
        <li key={i}>
          {s.file} ({s.kind}
          {s.translation ? `, ${s.translation}` : ''}): {s.imported.toLocaleString()} imported,{' '}
          {s.skipped.toLocaleString()} skipped
          {s.errors.length > 0 && (
            <ul>
              {s.errors.slice(0, 5).map((e: ImportError, j) => (
                <li key={j}>
                  {e.identifier} — {describeSkipReason(e.reason)}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
