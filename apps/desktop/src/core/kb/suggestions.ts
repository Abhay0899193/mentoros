import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { KbSuggestedSource } from "../types.js";
import type { IKbStore } from "./store.js";
import { normalizePath, sourceIdForPath } from "./paths.js";

/**
 * Proactive KB suggestions (§4.7). MentorOS offers to index the interview-prep
 * playbooks that already power the learning engine, so grounded answers can cite
 * them. Only paths that actually exist as folders are offered; each is marked
 * `ingested` when a source row already exists.
 */

interface Candidate {
  relPath: string; // relative to home
  title: string;
  tags: string[];
  reason: string;
}

const CANDIDATES: Candidate[] = [
  {
    relPath: "Documents/abhay/interview-prep/DSA/patterns",
    title: "DSA Pattern Playbooks",
    tags: ["dsa", "patterns"],
    reason:
      "The 9 pattern playbooks feed your interview prep — index them so answers can ground on and cite the exact playbook.",
  },
  {
    relPath: "Documents/abhay/interview-prep/System Design/concepts",
    title: "System Design Concepts",
    tags: ["system-design"],
    reason:
      "Your system-design concept notes — index them so architecture answers can cite your own material.",
  },
];

function isDir(abs: string): boolean {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

export function suggestSources(store: IKbStore): KbSuggestedSource[] {
  const home = homedir();
  const out: KbSuggestedSource[] = [];
  for (const c of CANDIDATES) {
    const abs = normalizePath(join(home, c.relPath));
    if (!isDir(abs)) continue;
    out.push({
      path: abs,
      title: c.title,
      kind: "folder",
      tags: c.tags,
      reason: c.reason,
      ingested: store.getSource(sourceIdForPath(abs)) !== undefined,
    });
  }
  return out;
}
