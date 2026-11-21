import { store } from "@simplestack/store";
import { desktopApi } from "../desktopApi";
import { terminalOpenStore, viewerStore, workspacePathStore } from "./state";
import { activeTabIdStore, tabsStore } from "./tabStore";
import type { TabId } from "./tabs";

/** One running shell. Sessions live in the main process; this only tracks them. */
export type TerminalSession = { id: string; title: string };

export type DocumentTerminals = {
	sessions: TerminalSession[];
	activeSessionId: string | null;
};

/** Terminal tabs are scoped to a document tab: each keeps its own list and selection. */
export type TerminalTabsState = {
	byDocTab: Record<TabId, DocumentTerminals>;
};

export type StartSessionOptions = { initialCommand?: string };

export const emptyDocTerminals = (): DocumentTerminals => ({
	sessions: [],
	activeSessionId: null,
});

export const terminalTabsStore = store<TerminalTabsState>({ byDocTab: {} });

/** The terminals shown for a document tab; empty when it has none yet. */
export function docTerminals(
	state: TerminalTabsState,
	docTabId: TabId | null | undefined,
): DocumentTerminals {
	if (!docTabId) return emptyDocTerminals();
	return state.byDocTab[docTabId] ?? emptyDocTerminals();
}

function findSessionOwner(
	state: TerminalTabsState,
	sessionId: string,
): TabId | null {
	for (const [docTabId, entry] of Object.entries(state.byDocTab)) {
		if (entry.sessions.some((session) => session.id === sessionId)) {
			return docTabId;
		}
	}
	return null;
}

function fallbackActiveSessionId(
	sessions: TerminalSession[],
	activeSessionId: string | null,
): string | null {
	if (
		activeSessionId &&
		sessions.some((session) => session.id === activeSessionId)
	) {
		return activeSessionId;
	}
	return sessions[sessions.length - 1]?.id ?? null;
}

export function withSessionAdded(
	state: TerminalTabsState,
	docTabId: TabId,
	session: TerminalSession,
): TerminalTabsState {
	const current = state.byDocTab[docTabId] ?? emptyDocTerminals();
	return {
		byDocTab: {
			...state.byDocTab,
			[docTabId]: {
				sessions: [...current.sessions, session],
				activeSessionId: session.id,
			},
		},
	};
}

/** Session ids are unique across the window, so the owning document tab is found by id. */
export function withSessionRemoved(
	state: TerminalTabsState,
	sessionId: string,
): TerminalTabsState {
	const owner = findSessionOwner(state, sessionId);
	if (!owner) return state;
	const entry = state.byDocTab[owner];
	if (!entry) return state;
	const sessions = entry.sessions.filter((session) => session.id !== sessionId);
	if (sessions.length === 0) return withDocTabTerminalsDropped(state, owner);
	return {
		byDocTab: {
			...state.byDocTab,
			[owner]: {
				sessions,
				activeSessionId: fallbackActiveSessionId(
					sessions,
					entry.activeSessionId,
				),
			},
		},
	};
}

export function withSessionActivated(
	state: TerminalTabsState,
	docTabId: TabId,
	sessionId: string,
): TerminalTabsState {
	const entry = state.byDocTab[docTabId];
	if (!entry?.sessions.some((session) => session.id === sessionId)) {
		return state;
	}
	if (entry.activeSessionId === sessionId) return state;
	return {
		byDocTab: {
			...state.byDocTab,
			[docTabId]: { ...entry, activeSessionId: sessionId },
		},
	};
}

export function withSessionRenamed(
	state: TerminalTabsState,
	sessionId: string,
	title: string,
): TerminalTabsState {
	const owner = findSessionOwner(state, sessionId);
	if (!owner) return state;
	const entry = state.byDocTab[owner];
	if (!entry) return state;
	return {
		byDocTab: {
			...state.byDocTab,
			[owner]: {
				...entry,
				sessions: entry.sessions.map((session) =>
					session.id === sessionId ? { ...session, title } : session,
				),
			},
		},
	};
}

/** Forget a document tab's terminals; callers stop its sessions first. */
export function withDocTabTerminalsDropped(
	state: TerminalTabsState,
	docTabId: TabId,
): TerminalTabsState {
	if (!(docTabId in state.byDocTab)) return state;
	const { [docTabId]: _dropped, ...byDocTab } = state.byDocTab;
	return { byDocTab };
}

/**
 * Boots a shell for one document tab and files it there when it arrives, even
 * if the user switched document tabs while it started. A workspace switch
 * mid-boot drops the shell and retries; a panel close gives up.
 */
export async function startTerminalSession(
	docTabId: TabId,
	title: string,
	options: StartSessionOptions = {},
): Promise<void> {
	while (true) {
		const requestedWorkspacePath = workspacePathStore.get();
		if (!requestedWorkspacePath) return;
		const notePath = viewerStore.get().currentPath ?? undefined;
		const sessionId = await desktopApi.terminalStart(requestedWorkspacePath, {
			...(notePath ? { notePath } : {}),
			...options,
		});
		if (workspacePathStore.get() === requestedWorkspacePath) {
			addSession(docTabId, { id: sessionId, title });
			return;
		}
		// The workspace changed while this shell booted. Adopting it would
		// show a shell cwd'd to the old workspace, so drop it and retry.
		void desktopApi.terminalStop(sessionId);
		if (!terminalOpenStore.get()) return;
	}
}

/** Files a new session under its document tab, falling back to the active one. */
function addSession(docTabId: TabId, session: TerminalSession) {
	terminalTabsStore.set((state) => {
		const live = tabsStore.get().order;
		// A workspace switch mid-boot strands the original document tab; a
		// session arriving for it belongs to whichever tab is open now.
		const owner = live.includes(docTabId)
			? docTabId
			: (activeTabIdStore.get() ?? docTabId);
		return withSessionAdded(state, owner, session);
	});
}
