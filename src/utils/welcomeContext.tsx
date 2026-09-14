/**
 * Dynamic welcome-screen context.
 *
 * Derives the greeting line and the suggested-task cards from the actual
 * state of the current workspace — no hardcoded content. Pure functions over
 * plain inputs (tree, tasks, chat sessions) so they're trivially testable;
 * the component just feeds them from the existing Zustand store.
 *
 * Signals used:
 *  - workspace present or not; empty workspace (no files in tree)
 *  - detected stack (package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod, .git…)
 *  - tests / README / CI presence
 *  - uncommitted-looking dirty editor buffers (unsaved changes)
 *  - recent agent task history (last finished task → "resume" card)
 * Skipped signals (deliberately): time-of-day tone (gimmicky, no natural fit
 * with the current voice), uncommitted *git* changes (would need a backend
 * git-status call per render — dirty buffers cover the common case cheaply),
 * per-file recency (the file tree API doesn't carry mtimes), and chat-session
 * recency (sessions aren't workspace-scoped, so they'd mislead).
 */
import type { ReactNode } from 'react';
import type { FileNode, AgentTask } from '../../shared/types';

export interface WelcomeCard {
  id: string;
  icon: 'sparkles' | 'compass' | 'flask' | 'bug' | 'git' | 'history' | 'folder' | 'wand';
  label: string;
  prompt: string;
}

export interface WelcomeContext {
  /** Greeting line; `strong` spans render bold workspace names. */
  message: ReactNode;
  cards: WelcomeCard[];
}

interface WelcomeInput {
  hasWorkspace: boolean;
  workspaceName?: string;
  tree: FileNode | null;
  tasks: AgentTask[];
  dirtyFiles: string[];
}

/** Flatten the tree once; memoized by object identity upstream in the component. */
function collectFiles(tree: FileNode | null): { names: Set<string>; paths: Set<string>; count: number } {
  const names = new Set<string>();
  const paths = new Set<string>();
  let count = 0;
  const walk = (node: FileNode) => {
    if (node.type === 'file') {
      count++;
      names.add(node.name.toLowerCase());
      paths.add(node.path.toLowerCase());
    }
    node.children?.forEach(walk);
  };
  if (tree) walk(tree);
  return { names, paths, count };
}

export function getWelcomeContext(input: WelcomeInput): WelcomeContext {
  const { hasWorkspace, workspaceName, tree, tasks, dirtyFiles } = input;
  const files = collectFiles(tree);

  // ---------- Cards ----------
  const cards: WelcomeCard[] = [];
  const has = (n: string) => files.names.has(n);
  const hasSuffix = (...suffixes: string[]) => {
    for (const n of files.names) if (suffixes.some((s) => n.endsWith(s))) return true;
    return false;
  };

  const isNode = has('package.json');
  const isPython = has('requirements.txt') || has('pyproject.toml') || hasSuffix('.py');
  const hasTests = hasSuffix('.test.ts', '.test.tsx', '.test.js', '.spec.ts', '.spec.js') ||
    has('jest.config.js') || has('jest.config.ts') || has('vitest.config.ts') || has('pytest.ini') ||
    files.paths.has('test') || files.paths.has('tests');
  const hasReadme = files.names.has('readme.md') || files.names.has('readme');

  const finished = tasks
    .filter((t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  if (!hasWorkspace) {
    cards.push(
      { id: 'add-folder', icon: 'folder', label: 'Open a folder', prompt: '' }, // handled specially by the component
      { id: 'scaffold', icon: 'sparkles', label: 'Scaffold a new project', prompt: 'Scaffold a new project from scratch: pick a sensible stack, create the structure, and make it run.' },
    );
  } else if (files.count === 0) {
    cards.push(
      { id: 'scaffold', icon: 'sparkles', label: 'Scaffold a new project', prompt: 'Scaffold a new project in this empty workspace: choose a fitting stack, create the structure, and make it run.' },
      { id: 'import-template', icon: 'wand', label: 'Import from a template', prompt: 'Set up this workspace from a well-known starter template of your choice — explain the pick first.' },
      { id: 'plan', icon: 'compass', label: 'Plan the project', prompt: 'Help me plan a project for this workspace: ask me a few questions, then write the plan to PLAN.md.' },
    );
  } else {
    if (finished) {
      const verb = finished.status === 'completed' ? 'completed' : finished.status === 'failed' ? 'failed' : 'cancelled';
      const cleanTitle = finished.title.replace(/\s+/g, ' ').trim().slice(0, 48);
      cards.push({
        id: 'resume',
        icon: 'history',
        label: `Resume: ${cleanTitle}${finished.title.length > 48 ? '…' : ''}`,
        prompt: `Continue from where the last agent task left off. It ${verb} recently: "${finished.title}". Review its result and finish the remaining work.`,
      });
    }
    if (dirtyFiles.length > 0) {
      cards.push({
        id: 'review-changes',
        icon: 'git',
        label: 'Review pending changes',
        prompt: `I have unsaved changes in ${dirtyFiles.length} file(s): ${dirtyFiles.slice(0, 3).join(', ')}${dirtyFiles.length > 3 ? '…' : ''}. Review them, summarize the intent, and flag anything risky before I save.`,
      });
    }
    if (!hasTests) {
      cards.push({
        id: 'add-tests',
        icon: 'flask',
        label: 'Add test coverage',
        prompt: isNode
          ? 'Add a lightweight test setup (vitest) to this project and write tests for the core logic.'
          : 'Add a test setup appropriate for this project and write tests for its core logic.',
      });
    }
    if (!hasReadme) {
      cards.push({
        id: 'add-readme',
        icon: 'compass',
        label: 'Write a README',
        prompt: 'Write a concise README.md for this project: what it is, how to run it, and its structure.',
      });
    }
    cards.push(
      { id: 'tour', icon: 'compass', label: 'Tour this codebase', prompt: 'Give me a tour of this project: entry points, structure, and how the pieces fit together.' },
      { id: 'fix', icon: 'bug', label: 'Fix something broken', prompt: 'Look for bugs or errors in this project, list what you find, and fix the most important one.' },
    );
  }
  // Cap the grid at 4 cards, ranked by the order above (resume/review first).
  const capped = cards.slice(0, 4);

  // ---------- Message ----------
  let message: WelcomeContext['message'];
  if (!hasWorkspace) {
    message = 'Open a folder to begin, or let the agent scaffold an entire project from a single sentence.';
  } else if (files.count === 0) {
    message = workspaceName ? <>{workspaceName} is empty — describe what to build and the agent will scaffold it.</> : 'This workspace is empty — describe what to build and the agent will scaffold it.';
  } else if (dirtyFiles.length > 0) {
    message = <>Welcome back to <strong>{workspaceName}</strong> — {dirtyFiles.length} unsaved change{dirtyFiles.length > 1 ? 's' : ''} waiting.</>;
  } else if (isNode || isPython) {
    message = <>Welcome back to <strong>{workspaceName}</strong>.</>;
  } else {
    message = <>Working in <strong>{workspaceName}</strong> — describe a task and the agent will dig in.</>;
  }

  return { message, cards: capped };
}
