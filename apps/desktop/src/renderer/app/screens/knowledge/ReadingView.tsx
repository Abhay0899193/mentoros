import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Circle, Check, ExternalLink, FileWarning } from 'lucide-react';
import { coreClient } from '../../../lib/coreClient';
import { useKb } from '../../../lib/kbStore';
import { Button, Chip } from '../../../ui';
import { RichText } from '../chat/RichText';
import { KindGlyph } from './KindGlyph';
import { KIND_LABEL } from './kbMeta';
import { ReadingMarkdown } from './ReadingMarkdown';
import { buildCollections, findCollection, partNumber, weekNumbers } from './collections';

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
  const sources = useKb((s) => s.sources);
  const selectedCollectionId = useKb((s) => s.selectedCollectionId);
  const setRead = useKb((s) => s.setRead);

  const source = sources.find((x) => x.id === readingId) ?? null;
  const collections = useMemo(() => buildCollections(sources), [sources]);
  const currentCollection =
    selectedCollectionId !== 'all' ? findCollection(collections, selectedCollectionId) : null;

  const siblingParts = useMemo(() => {
    if (!source) return [];
    const weeks = weekNumbers(source.tags);
    const part = partNumber(source.tags);
    if (weeks.length === 0 || part === null) return [];
    return sources
      .filter(
        (s) =>
          s.tags.includes('study-guide') &&
          partNumber(s.tags) !== null &&
          weekNumbers(s.tags).some((w) => weeks.includes(w)),
      )
      .sort((a, b) => (partNumber(a.tags) ?? 0) - (partNumber(b.tags) ?? 0));
  }, [sources, source]);
  const siblingIdx = source ? siblingParts.findIndex((s) => s.id === source.id) : -1;
  const prevPart = siblingIdx > 0 ? siblingParts[siblingIdx - 1] : null;
  const nextPart =
    siblingIdx >= 0 && siblingIdx < siblingParts.length - 1 ? siblingParts[siblingIdx + 1] : null;

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
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3">
        <button
          onClick={closeReading}
          className="tap-target flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-small text-muted hover:bg-surface-2 hover:text-ink"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          Library
        </button>
        {content && (
          <>
            <span className="hidden text-faint sm:inline">/</span>
            {currentCollection && (
              <>
                <span className="hidden max-w-[140px] truncate text-small text-muted sm:inline">
                  {currentCollection.label}
                </span>
                <span className="hidden text-faint sm:inline">/</span>
              </>
            )}
            <KindGlyph kind={content.kind} size="sm" />
            <h1 className="min-w-0 flex-1 truncate text-h3 text-ink">{content.title}</h1>
            <Chip>{KIND_LABEL[content.kind]}</Chip>
            <div className="ml-auto flex items-center gap-2">
              {source && (
                <Button
                  size="sm"
                  variant={source.readAt ? 'ghost' : 'secondary'}
                  icon={
                    source.readAt ? (
                      <Check size={14} strokeWidth={1.5} />
                    ) : (
                      <Circle size={14} strokeWidth={1.5} />
                    )
                  }
                  onClick={() => void setRead(readingId, !source.readAt)}
                >
                  {source.readAt ? 'Read ✓' : 'Mark read'}
                </Button>
              )}
              {content.kind === 'pdf' && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ExternalLink size={14} strokeWidth={1.5} />}
                  onClick={() => void coreClient.openKbSource(readingId)}
                >
                  Open in Finder
                </Button>
              )}
            </div>
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
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden md:flex-row md:gap-6">
          {content?.files && content.files.length > 0 && (
            <nav className="shrink-0 overflow-x-auto border-b border-line pb-2 md:w-56 md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0 md:pr-3 md:pb-0">
              <ul className="flex gap-1 md:flex-col md:gap-0.5">
                {content.files.map((f) => (
                  <li key={f} className="shrink-0 md:shrink">
                    <button
                      onClick={() => openReading(readingId, f)}
                      className={
                        f === readingFile
                          ? 'tap-target block max-w-[220px] truncate rounded-[8px] bg-surface-2 px-2.5 py-1.5 text-left text-small text-ink md:w-full md:max-w-none'
                          : 'tap-target block max-w-[220px] truncate rounded-[8px] px-2.5 py-1.5 text-left text-small text-muted hover:bg-surface-2 hover:text-body md:w-full md:max-w-none'
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
                {isMarkdown ? (
                  <ReadingMarkdown text={content.text} onOpenRelative={handleOpenRelative} />
                ) : (
                  <RichText text={content.text} />
                )}

                {(prevPart || nextPart) && (
                  <div className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-4">
                    {prevPart ? (
                      <button
                        onClick={() => openReading(prevPart.id)}
                        className="tap-target flex min-w-0 items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left text-small text-muted hover:bg-surface-2 hover:text-ink"
                      >
                        <ChevronLeft size={14} strokeWidth={1.5} className="shrink-0" />
                        <span className="truncate">Previous part · {prevPart.title}</span>
                      </button>
                    ) : (
                      <span />
                    )}
                    {nextPart ? (
                      <button
                        onClick={() => openReading(nextPart.id)}
                        className="tap-target flex min-w-0 items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-right text-small text-muted hover:bg-surface-2 hover:text-ink"
                      >
                        <span className="truncate">Next part · {nextPart.title}</span>
                        <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                )}
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
