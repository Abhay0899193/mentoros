import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Search, Plus } from 'lucide-react';
import { useKb } from '../../../lib/kbStore';
import { pathForFile } from '../../../lib/nativeBridge';
import { toast, Button } from '../../../ui';
import { DropZone } from './DropZone';
import { LibraryGrid } from './LibraryGrid';
import { SearchView } from './SearchView';
import { ReadingView } from './ReadingView';
import { AddSourcePopover } from './AddSourcePopover';

/** Personal Knowledge Base (plan.md §4.7): library, hybrid search, reading view. */
export function KnowledgeScreen() {
  const init = useKb((s) => s.init);
  const query = useKb((s) => s.query);
  const setQuery = useKb((s) => s.setQuery);
  const runSearch = useKb((s) => s.runSearch);
  const ingest = useKb((s) => s.ingest);
  const readingId = useKb((s) => s.readingId);
  const setAddOpen = useKb((s) => s.setAddOpen);

  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => init(), [init]);

  useEffect(() => {
    const id = setTimeout(() => void runSearch(query), 250);
    return () => clearTimeout(id);
  }, [query, runSearch]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function hasFiles(e: DragEvent) {
    return Array.from(e.dataTransfer.types).includes('Files');
  }

  function onDragEnter(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter.current += 1;
    setDragging(true);
  }
  function onDragOver(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
  }
  function onDragLeave() {
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragging(false);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      const path = pathForFile(file);
      if (!path) {
        toast({
          tone: 'danger',
          title: `Couldn't read "${file.name}"`,
          description:
            'MentorOS could not resolve a filesystem path for this item — try the Add source button instead.',
        });
        continue;
      }
      void ingest(path, { title: file.name.replace(/\.[a-z0-9]+$/i, '') });
    }
  }

  return (
    <div
      className="relative flex h-full flex-col"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="flex flex-col gap-2 px-4 py-3 md:h-14 md:shrink-0 md:flex-row md:items-center md:justify-between md:gap-4 md:px-6 md:py-0">
        <h1 className="shrink-0 whitespace-nowrap text-h2 text-ink">Knowledge base</h1>
        <div className="flex min-w-0 items-center gap-2 md:flex-1 md:justify-end">
          <div className="flex h-8 w-full min-w-0 items-center gap-2 rounded-full bg-surface-2 hairline px-3 focus-within:border-line-strong md:w-40 md:max-w-72 md:flex-1">
            <Search size={13} strokeWidth={1.5} className="shrink-0 text-faint" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your sources… (press /)"
              aria-label="Search knowledge base"
              className="w-full bg-transparent text-small text-ink outline-none placeholder:text-faint"
            />
          </div>
          <div className="relative shrink-0">
            <Button
              size="sm"
              className="whitespace-nowrap"
              icon={<Plus size={14} strokeWidth={1.5} />}
              onClick={() => setAddOpen(true)}
            >
              Add source
            </Button>
            <AddSourcePopover />
          </div>
        </div>
      </header>

      <div
        className={
          readingId
            ? 'min-h-0 flex-1 overflow-hidden px-4 pb-6 @container md:px-6'
            : 'min-h-0 flex-1 overflow-y-auto px-4 pb-10 @container md:px-6'
        }
      >
        {readingId ? <ReadingView /> : query.trim() !== '' ? <SearchView /> : <LibraryGrid />}
      </div>

      <DropZone active={dragging} />
    </div>
  );
}
