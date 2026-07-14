import { Fragment, type ReactNode } from 'react';
import { useKb } from '../../../lib/kbStore';
import { cn } from '../../../lib/cn';
import { type CollectionNode, unreadCount } from './collections';

function flatten(nodes: CollectionNode[]): CollectionNode[] {
  return nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])]);
}

function UnreadCount({ n }: { n: number }) {
  if (n === 0) return null;
  return <span className="ml-auto shrink-0 pl-2 text-[11px] text-faint tabular">{n}</span>;
}

/**
 * Collections nav (§Phase C): left tree at ≥lg, horizontal chip strip below —
 * derived entirely from source tags, no extra fetch (`buildCollections`).
 */
export function CollectionsNav({ collections }: { collections: CollectionNode[] }) {
  const selectedId = useKb((s) => s.selectedCollectionId);
  const setSelectedCollection = useKb((s) => s.setSelectedCollection);

  function renderTree(nodes: CollectionNode[], depth: number): ReactNode {
    return nodes.map((node) => (
      <Fragment key={node.id}>
        <button
          onClick={() => setSelectedCollection(node.id)}
          aria-current={node.id === selectedId ? 'page' : undefined}
          style={depth > 0 ? { paddingLeft: `${10 + depth * 14}px` } : undefined}
          className={cn(
            'flex w-full items-center rounded-[8px] py-1.5 pr-2.5 pl-2.5 text-left text-small',
            node.id === selectedId ? 'bg-surface-2 text-ink' : 'text-muted hover:bg-surface-2 hover:text-body',
          )}
        >
          <span className="min-w-0 truncate">{node.label}</span>
          <UnreadCount n={unreadCount(node)} />
        </button>
        {node.children && renderTree(node.children, depth + 1)}
      </Fragment>
    ));
  }

  return (
    <>
      <nav aria-label="Collections" className="hidden w-48 shrink-0 flex-col gap-0.5 lg:flex">
        {renderTree(collections, 0)}
      </nav>

      <div className="flex gap-1.5 overflow-x-auto pb-1 lg:hidden">
        {flatten(collections).map((node) => {
          const isActive = node.id === selectedId;
          const unread = unreadCount(node);
          return (
            <button
              key={node.id}
              onClick={() => setSelectedCollection(node.id)}
              className={cn(
                'tap-target flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-small whitespace-nowrap hairline',
                isActive ? 'bg-surface-2 text-ink' : 'bg-surface-1 text-muted hover:bg-surface-2 hover:text-body',
              )}
            >
              {node.label}
              {unread > 0 && <span className="text-[11px] text-faint tabular">{unread}</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}
