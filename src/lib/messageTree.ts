// ---------------------------------------------------------------------------
// Conversation-tree helpers.
//
// A `ChatSession` stores every message from every branch in a flat `messages`
// array. Structure is defined by each message's `parentId`, and the currently
// visible linear thread is derived by walking parent links from the session's
// `currentLeafId` up to the root. These pure functions do that derivation and
// the sibling bookkeeping that powers the `‹1/2›` branch switcher.
// ---------------------------------------------------------------------------

import type { ChatSession, Message } from '@/types'

/** Index messages by id for O(1) parent walks. */
function byId(messages: Message[]): Map<string, Message> {
  const map = new Map<string, Message>()
  for (const m of messages) map.set(m.id, m)
  return map
}

/**
 * The visible linear thread: walk from the leaf up via `parentId`, then reverse
 * to root→leaf order. Falls back to the last array element when `leafId` is
 * missing or stale (e.g. legacy data), and to an empty path when there are no
 * messages.
 */
export function activePath(
  messages: Message[],
  leafId: string | null | undefined,
): Message[] {
  if (messages.length === 0) return []
  const map = byId(messages)
  let leaf = leafId ? map.get(leafId) : undefined
  if (!leaf) leaf = messages[messages.length - 1]

  const path: Message[] = []
  const seen = new Set<string>()
  let cursor: Message | undefined = leaf
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    path.push(cursor)
    cursor = cursor.parentId ? map.get(cursor.parentId) : undefined
  }
  return path.reverse()
}

/** Direct children of `parentId` (use `null` for root nodes), ordered by time. */
export function childrenOf(
  messages: Message[],
  parentId: string | null,
): Message[] {
  return messages
    .filter((m) => (m.parentId ?? null) === parentId)
    .sort((a, b) => a.timestamp - b.timestamp)
}

export interface SiblingInfo {
  /** 0-based position of the message among its siblings. */
  index: number
  /** Total number of siblings (including the message itself). */
  total: number
  /** Sibling ids in display order. */
  siblingIds: string[]
}

/**
 * Where the message sits among nodes that share its parent — drives the
 * `<index+1 / total>` switcher. `total === 1` means no branch here.
 */
export function siblingInfo(
  messages: Message[],
  messageId: string,
): SiblingInfo {
  const target = messages.find((m) => m.id === messageId)
  if (!target) return { index: 0, total: 1, siblingIds: [messageId] }
  const siblings = childrenOf(messages, target.parentId ?? null)
  const siblingIds = siblings.map((s) => s.id)
  const index = siblingIds.indexOf(messageId)
  return { index: index === -1 ? 0 : index, total: siblings.length, siblingIds }
}

/**
 * The leaf to select when switching *to* `messageId`. If the session's current
 * leaf already descends from `messageId`, keep it; otherwise descend by newest
 * child until a leaf is reached. This keeps the user on a sensible tip after a
 * sibling switch.
 */
export function subtreeLeaf(
  messages: Message[],
  messageId: string,
  currentLeafId: string | null | undefined,
): string {
  const map = byId(messages)
  if (!map.has(messageId)) return messageId

  // Keep the current leaf if it lives inside messageId's subtree.
  if (currentLeafId && map.has(currentLeafId)) {
    let cursor: Message | undefined = map.get(currentLeafId)
    const seen = new Set<string>()
    while (cursor && !seen.has(cursor.id)) {
      if (cursor.id === messageId) return currentLeafId
      seen.add(cursor.id)
      cursor = cursor.parentId ? map.get(cursor.parentId) : undefined
    }
  }

  // Otherwise descend newest-child-first to a leaf.
  let node = messageId
  const guard = new Set<string>()
  for (;;) {
    if (guard.has(node)) break
    guard.add(node)
    const kids = childrenOf(messages, node)
    if (kids.length === 0) break
    node = kids[kids.length - 1].id
  }
  return node
}

/**
 * Migrate a legacy linear session (no branch metadata) into the tree shape:
 * chain messages in array order and point `currentLeafId` at the last one.
 * Idempotent — a session that already has branch fields is returned unchanged.
 */
export function migrateLinear(session: ChatSession): ChatSession {
  const alreadyTree =
    session.currentLeafId != null ||
    session.messages.some((m) => m.parentId != null)
  if (alreadyTree) return session
  if (session.messages.length === 0) {
    return { ...session, currentLeafId: null }
  }

  const messages = session.messages.map((m, i) => ({
    ...m,
    parentId: i === 0 ? null : session.messages[i - 1].id,
  }))
  return {
    ...session,
    messages,
    currentLeafId: messages[messages.length - 1].id,
  }
}
