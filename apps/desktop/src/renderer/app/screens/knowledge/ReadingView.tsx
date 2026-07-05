import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, FileWarning } from 'lucide-react';
import { coreClient } from '../../../lib/coreClient';
import { useKb } from '../../../lib/kbStore';
import { Button, Chip } from '../../../ui';
import { RichText } from '../chat/RichText';
import { KindGlyph } from './KindGlyph';
import { KIND_LABEL } from './kbMeta';
import { ReadingMarkdown } from './ReadingMarkdown';

/** Resolves a relative markdown link (./foo.md, ../x/bar.md) against the directory of the currently open file. */
function resolveRelativePath(baseFile: string, rel: string): string {
  const baseDir = baseFile.includes('/') ? baseFile.slice(0, baseFile.lastIndexOf('/')) : '';
  const parts = baseDir ? baseDir.split('/') : [];
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

type ReadingContent = Awaited<ReturnType<typeof coreClient.kbSourceText>>;

function SkeletonLines() {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3 pt-6">
      {[100, 92, 96, 60, 84, 74].map((w, i) => (
        <div key={i} className="h-3 animate-pulse rounded-full bg-surface-2" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

/** Reading pane (§4.7): md/txt render through RichText; PDFs show extracted text + Finder handoff. */
export function ReadingView() {
  const readingId = useKb((s) => s.readingId);
  const readingFile = useKb((s) => s.readingFile);
  const closeReading = useKb((s) => s.closeReading);
  const openReading = useKb((s) => s.openReading);

  const [content, setContent] = useState<ReadingContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!readingId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    coreClient
      .kbSourceText(readingId, readingFile ?? undefined)
      .then((res) => {
        if (!cancelled) {
          setContent(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not open this source — is the core running?');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [readingId, readingFile, reloadKey]);

  if (!readingId) return null;

  const currentFile = readingFile ?? content?.files?.[0] ?? '';
  const isMarkdown = content?.kind === 'md' || (content?.kind === 'folder' && /\.md$/i.test(currentFile));

  const handleOpenRelative = (relPath: string) => {
    if (!readingId || !content?.files?.length) return;
    const target = resolveRelativePath(currentFile, relPath);
    if (content.files.includes(target)) openReading(readingId, target);
  };

  return (
    <div className="flex h-full flex-col pt-4">
      <div className="mb-4 flex shrink-0 items-center gap-3">
        <button
          onClick={closeReading}
          className="flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-small text-muted hover:bg-surface-2 hover:text-ink"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          Library
        </button>
        {content && (
          <>
            <span className="text-faint">/</span>
            <KindGlyph kind={content.kind} size="sm" />
            <h1 className="truncate text-h3 text-ink">{content.title}</h1>
            <Chip>{KIND_LABEL[content.kind]}</Chip>
            {content.kind === 'pdf' && (
              <Button
                size="sm"
                variant="secondary"
                icon={<ExternalLink size={14} strokeWidth={1.5} />}
                className="ml-auto"
                onClick={() => void coreClient.openKbSource(readingId)}
              >
                Open in Finder
              </Button>
            )}
          </>
        )}
      </div>

      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <FileWarning size={26} strokeWidth={1.5} className="text-faint" />
          <p className="text-small text-muted">{error}</p>
          <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </Button>
        </div>
      ) : loading ? (
        <SkeletonLines />
      ) : (
        <div className="flex min-h-0 flex-1 gap-6 overflow-hidden">
          {content?.files && content.files.length > 0 && (
            <nav className="w-56 shrink-0 overflow-y-auto border-r border-line pr-3">
              <ul className="flex flex-col gap-0.5">
                {content.files.map((f) => (
                  <li key={f}>
                    <button
                      onClick={() => openReading(readingId, f)}
                      className={
                        f === readingFile
                          ? 'block w-full truncate rounded-[8px] bg-surface-2 px-2.5 py-1.5 text-left text-small text-ink'
                          : 'block w-full truncate rounded-[8px] px-2.5 py-1.5 text-left text-small text-muted hover:bg-surface-2 hover:text-body'
                      }
                    >
                      {f}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {content?.kind === 'pdf' && (
              <p className="mx-auto mb-4 max-w-[720px] text-small text-faint">
                Extracted text — original opens in Finder.
              </p>
            )}
            {content && content.text.trim() !== '' ? (
              <div className="mx-auto max-w-[720px] pb-10">
                <RichText text={content.text} />
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 pt-16 text-center">
                <p className="text-small text-muted">
                  {content?.files?.length
                    ? 'Select a file to start reading.'
                    : 'This source has no extracted text yet.'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
