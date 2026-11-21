import { ContextMenu } from "@base-ui/react/context-menu";
import { Button, useResizeSeparator } from "@marky/ui";
import { useStoreValue } from "@simplestack/store/react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { desktopApi } from "../desktopApi";
import { cn } from "../lib/utils";
import {
	clearPendingTerminalCommand,
	setTerminalOpen,
	setTerminalPosition,
	toggleTerminal,
} from "../store/actions";
import type { TerminalPosition } from "../store/persistence";
import {
	pendingTerminalCommandStore,
	terminalOpenStore,
	terminalPositionStore,
	workspacePathStore,
} from "../store/state";
import { activeTabIdStore, tabsStore } from "../store/tabStore";
import type { TabId } from "../store/tabs";
import {
	docTerminals,
	type StartSessionOptions,
	startTerminalSession,
	terminalTabsStore,
	withSessionActivated,
	withSessionRemoved,
	withSessionRenamed,
} from "../store/terminalTabs";
import { isDarkTheme, subscribeTheme } from "../theme";
import "@xterm/xterm/css/xterm.css";
import MingcuteAddLine from "~icons/mingcute/add-line";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteCloseLine from "~icons/mingcute/close-line";
import MingcuteLayoutBottomLine from "~icons/mingcute/layout-bottom-line";
import MingcuteLayoutRightLine from "~icons/mingcute/layout-right-line";

const MIN_PANEL_HEIGHT = 100;
const MIN_PANEL_WIDTH = 240;

function clampPanelHeight(height: number) {
	return Math.max(
		MIN_PANEL_HEIGHT,
		Math.min(window.innerHeight - MIN_PANEL_HEIGHT, height),
	);
}

function clampPanelWidth(width: number) {
	return Math.max(
		MIN_PANEL_WIDTH,
		Math.min(window.innerWidth - MIN_PANEL_WIDTH, width),
	);
}

function cssColorToRgba(color: string): string {
	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 1;
	const ctx = canvas.getContext("2d");
	if (!ctx) return color;
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
	return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

const LIGHT_THEME = {
	black: "#000000",
	red: "#cd3131",
	green: "#00bc00",
	yellow: "#949800",
	blue: "#0451a5",
	magenta: "#bc05bc",
	cyan: "#0598bc",
	white: "#555555",
	brightBlack: "#666666",
	brightRed: "#cd3131",
	brightGreen: "#14ce14",
	brightYellow: "#b5ba00",
	brightBlue: "#0451a5",
	brightMagenta: "#bc05bc",
	brightCyan: "#0598bc",
	brightWhite: "#a5a5a5",
};

const DARK_THEME = {
	black: "#000000",
	red: "#cd3131",
	green: "#0dbc79",
	yellow: "#e5e510",
	blue: "#2472c8",
	magenta: "#bc3fbc",
	cyan: "#11a8cd",
	white: "#e5e5e5",
	brightBlack: "#666666",
	brightRed: "#f14c4c",
	brightGreen: "#23d18b",
	brightYellow: "#f5f543",
	brightBlue: "#3b8eea",
	brightMagenta: "#d670d6",
	brightCyan: "#29b8db",
	brightWhite: "#e5e5e5",
};

export function TerminalPanel() {
	const isOpen = useStoreValue(terminalOpenStore);
	const workspacePath = useStoreValue(workspacePathStore);
	const pendingTerminalCommand = useStoreValue(pendingTerminalCommandStore);
	const position = useStoreValue(terminalPositionStore);
	const tabs = useStoreValue(tabsStore);
	const activeTabId = useStoreValue(activeTabIdStore);
	const terminalTabs = useStoreValue(terminalTabsStore);
	// Only the active document tab's terminals are shown; every other
	// document tab's sessions keep running (and buffering) in the background.
	const { sessions, activeSessionId } = docTerminals(terminalTabs, activeTabId);
	const [height, setHeight] = useState(256);
	const [width, setWidth] = useState(420);
	const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
		null,
	);
	const [renameDraft, setRenameDraft] = useState("");
	const [startError, setStartError] = useState<string | null>(null);
	const isInitializingRef = useRef(false);
	const previousSessionCountRef = useRef(0);
	const previousAutoCloseTabIdRef = useRef<TabId | null | undefined>(undefined);
	const previousInitTabIdRef = useRef<TabId | null | undefined>(undefined);
	const previousInitWorkspacePathRef = useRef<string | null | undefined>(
		undefined,
	);

	const { isResizing, separatorProps } = useResizeSeparator({
		axis: position === "right" ? "col" : "row",
		label: "Resize terminal panel",
		value: position === "right" ? width : height,
		min: position === "right" ? MIN_PANEL_WIDTH : MIN_PANEL_HEIGHT,
		max: () =>
			position === "right"
				? window.innerWidth - MIN_PANEL_WIDTH
				: window.innerHeight - MIN_PANEL_HEIGHT,
		onChange: (next) =>
			position === "right"
				? setWidth(clampPanelWidth(next))
				: setHeight(clampPanelHeight(next)),
		getPointerValue: ({ event }) =>
			position === "right"
				? window.innerWidth - event.clientX
				: window.innerHeight - event.clientY,
	});

	// Stop the terminals of document tabs that are gone: a closed tab, or the
	// tab set a workspace switch replaced. Live tabs' sessions keep running.
	useEffect(() => {
		const live = new Set(tabs.order);
		const orphanedSessions = Object.entries(terminalTabs.byDocTab)
			.filter(([docTabId]) => !live.has(docTabId))
			.flatMap(([, entry]) => entry.sessions.map((session) => session.id));
		if (orphanedSessions.length === 0) return;
		terminalTabsStore.set((state) => {
			const liveNow = new Set(tabsStore.get().order);
			return {
				byDocTab: Object.fromEntries(
					Object.entries(state.byDocTab).filter(([docTabId]) =>
						liveNow.has(docTabId),
					),
				),
			};
		});
		for (const sessionId of orphanedSessions) {
			void desktopApi.terminalStop(sessionId);
		}
	}, [tabs, terminalTabs]);

	// Closing the active document tab's last terminal closes the panel — but
	// switching document tabs must not, even when the new tab has none.
	useEffect(() => {
		const switchedDocTab = previousAutoCloseTabIdRef.current !== activeTabId;
		previousAutoCloseTabIdRef.current = activeTabId;
		const previousCount = previousSessionCountRef.current;
		previousSessionCountRef.current = sessions.length;
		if (switchedDocTab) return;
		if (!(previousCount > 0 && sessions.length === 0)) return;
		isInitializingRef.current = false;
		queueMicrotask(() => setTerminalOpen(false));
	}, [activeTabId, sessions.length]);

	const startSession = async (
		title: string,
		options: StartSessionOptions = {},
	) => {
		if (!activeTabId) return;
		setStartError(null);
		try {
			await startTerminalSession(activeTabId, title, options);
		} catch (error) {
			console.error("Failed to start terminal session:", error);
			setStartError(
				"Terminal unavailable. The bundled shell module failed to load.",
			);
		}
	};

	// Start sessions while the panel is open: a pending chat command gets its
	// own tab; otherwise an empty panel boots a plain shell. Switching document
	// tabs starts nothing — an empty strip waits for the + button. A workspace
	// switch boots a fresh shell right away. sessions.length retries a chat
	// launch that arrived while another session was starting.
	// biome-ignore lint/correctness/useExhaustiveDependencies: startSession is render-local
	useEffect(() => {
		const switchedWorkspace =
			previousInitWorkspacePathRef.current !== workspacePath;
		const switchedDocTab = previousInitTabIdRef.current !== activeTabId;
		previousInitWorkspacePathRef.current = workspacePath;
		previousInitTabIdRef.current = activeTabId;
		if (!isOpen || !workspacePath || !activeTabId) return;
		if (switchedDocTab && !switchedWorkspace && !pendingTerminalCommand) {
			setStartError(null);
			return;
		}
		if (isInitializingRef.current) return;
		if (!pendingTerminalCommand && sessions.length > 0) return;

		isInitializingRef.current = true;
		const sessionPromise = pendingTerminalCommand
			? startSession(pendingTerminalCommand.split(/\s+/, 1)[0] || "chat", {
					initialCommand: pendingTerminalCommand,
				})
			: startSession("bash");
		void sessionPromise.then(
			() => {
				if (pendingTerminalCommand) clearPendingTerminalCommand();
				isInitializingRef.current = false;
			},
			() => {
				isInitializingRef.current = false;
			},
		);
	}, [
		isOpen,
		pendingTerminalCommand,
		workspacePath,
		activeTabId,
		sessions.length,
	]);

	const handleCloseSession = async (sessionId: string) => {
		await desktopApi.terminalStop(sessionId);
		terminalTabsStore.set((state) => withSessionRemoved(state, sessionId));
	};

	const handleSessionExit = (sessionId: string) => {
		terminalTabsStore.set((state) => withSessionRemoved(state, sessionId));
	};

	const beginRename = (session: { id: string; title: string }) => {
		setRenamingSessionId(session.id);
		setRenameDraft(session.title);
	};

	const commitRename = () => {
		if (!renamingSessionId) return;
		const title = renameDraft.trim();
		if (title) {
			terminalTabsStore.set((state) =>
				withSessionRenamed(state, renamingSessionId, title),
			);
		}
		setRenamingSessionId(null);
	};

	// Sessions of background document tabs stay mounted (hidden) so their
	// scrollback keeps buffering while another note's terminals are shown.
	const mountedSessions = Object.entries(terminalTabs.byDocTab).flatMap(
		([docTabId, entry]) =>
			entry.sessions.map((session) => ({ docTabId, session })),
	);

	return (
		<div
			style={
				position === "right"
					? { width: isOpen ? width : undefined }
					: { height: isOpen ? height : undefined }
			}
			className={cn(
				"flex flex-col border-border bg-background z-20 relative",
				position === "right" ? "border-l" : "border-t",
				isResizing && "select-none",
				!isOpen && "hidden",
			)}
		>
			<div
				className={cn(
					"group absolute outline-none z-30",
					position === "right"
						? "-left-1.25 top-0 bottom-0 w-2.5 cursor-col-resize"
						: "-top-1.25 left-0 right-0 h-2.5 cursor-row-resize",
				)}
				{...separatorProps}
			>
				<span
					className={cn(
						"absolute bg-transparent group-focus:bg-primary",
						position === "right"
							? "top-0 bottom-0 left-1/2 w-px"
							: "left-0 right-0 top-1/2 h-px",
						isResizing && "bg-primary",
					)}
				/>
			</div>
			{/* Terminal Tabs */}
			<TerminalRibbonMenu position={position}>
				<div className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar">
					{sessions.map((session) => (
						<div
							key={session.id}
							className={cn(
								"group relative flex min-w-20 max-w-48 items-center rounded-md text-xs transition-colors",
								activeSessionId === session.id
									? "bg-background text-foreground border border-border"
									: "text-muted-foreground hover:bg-muted",
							)}
						>
							{renamingSessionId === session.id ? (
								<input
									// biome-ignore lint/a11y/noAutofocus: rename input appears on explicit double click
									autoFocus
									aria-label="Rename terminal session"
									className="w-40 min-w-0 bg-transparent px-3 py-1 text-xs outline-none"
									value={renameDraft}
									onFocus={(event) => event.currentTarget.select()}
									onChange={(event) => setRenameDraft(event.target.value)}
									onBlur={commitRename}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											commitRename();
										} else if (event.key === "Escape") {
											event.preventDefault();
											setRenamingSessionId(null);
										}
									}}
								/>
							) : (
								<button
									type="button"
									aria-pressed={activeSessionId === session.id}
									className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[inherit] px-3 py-1"
									title="Double click to rename"
									onClick={() => {
										if (!activeTabId) return;
										terminalTabsStore.set((state) =>
											withSessionActivated(state, activeTabId, session.id),
										);
									}}
									onDoubleClick={() => beginRename(session)}
								>
									<span className="truncate flex-1">{session.title}</span>
								</button>
							)}
							{renamingSessionId !== session.id ? (
								<button
									type="button"
									aria-label={`Close terminal session ${session.title}`}
									className={cn(
										"pointer-events-none absolute end-1 z-10 -translate-y-1/2 rounded-sm p-0.5 opacity-0 transition-opacity [inset-block-start:50%] group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus:pointer-events-auto focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-ring",
										activeSessionId === session.id
											? "bg-background"
											: "bg-muted",
									)}
									onClick={() => void handleCloseSession(session.id)}
								>
									<MingcuteCloseLine className="size-3" />
								</button>
							) : null}
						</div>
					))}
					<Button
						variant="ghost"
						size="icon-sm"
						className="ml-1"
						onClick={() => void startSession("bash")}
						aria-label="New Terminal"
						title="New Terminal"
					>
						<MingcuteAddLine className="size-4" />
					</Button>
				</div>
				<div className="flex items-center gap-1 pl-4">
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={toggleTerminal}
						aria-label="Close Terminal Panel"
						title="Close Terminal Panel"
					>
						<MingcuteCloseLine className="size-4" />
					</Button>
				</div>
			</TerminalRibbonMenu>

			{/* Terminal Viewports */}
			<div className="flex-1 relative overflow-hidden bg-background p-2 pb-0">
				{mountedSessions.map(({ docTabId, session }) => {
					const isActive =
						docTabId === activeTabId && activeSessionId === session.id;
					return (
						<div
							key={session.id}
							className={cn(
								"absolute inset-2",
								isActive
									? "z-10 opacity-100"
									: "z-0 opacity-0 pointer-events-none",
							)}
						>
							<TerminalInstance
								onExit={handleSessionExit}
								sessionId={session.id}
								isActive={isActive}
							/>
						</div>
					);
				})}
				{sessions.length === 0 && (
					<div
						className={cn(
							"flex h-full items-center justify-center text-sm",
							startError ? "text-destructive" : "text-muted-foreground",
						)}
					>
						{startError ?? "No active terminal sessions."}
					</div>
				)}
			</div>
		</div>
	);
}

function TerminalRibbonMenu({
	position,
	children,
}: {
	position: TerminalPosition;
	children: ReactNode;
}) {
	return (
		<ContextMenu.Root>
			<ContextMenu.Trigger className="flex items-center h-9 px-2 border-b border-border bg-muted/30 select-none">
				{children}
			</ContextMenu.Trigger>
			<ContextMenu.Portal>
				<ContextMenu.Positioner className="isolate z-50 outline-none">
					<ContextMenu.Popup className="z-50 w-44 origin-(--transform-origin) rounded-sm border border-border bg-popover p-1 text-[11px] text-popover-foreground outline-hidden transition-[transform,opacity] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
						<TerminalPositionItem
							position="bottom"
							activePosition={position}
							icon={<MingcuteLayoutBottomLine className="size-3 shrink-0" />}
						>
							Dock to bottom
						</TerminalPositionItem>
						<TerminalPositionItem
							position="right"
							activePosition={position}
							icon={<MingcuteLayoutRightLine className="size-3 shrink-0" />}
						>
							Dock to right
						</TerminalPositionItem>
					</ContextMenu.Popup>
				</ContextMenu.Positioner>
			</ContextMenu.Portal>
		</ContextMenu.Root>
	);
}

function TerminalPositionItem({
	position,
	activePosition,
	icon,
	children,
}: {
	position: TerminalPosition;
	activePosition: TerminalPosition;
	icon: ReactNode;
	children: ReactNode;
}) {
	return (
		<ContextMenu.Item
			className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-start text-[11px] outline-hidden select-none data-highlighted:bg-accent"
			onClick={() => setTerminalPosition(position)}
		>
			{icon}
			<span className="min-w-0 flex-1">{children}</span>
			{activePosition === position && (
				<MingcuteCheckLine className="size-3 shrink-0" />
			)}
		</ContextMenu.Item>
	);
}

function TerminalInstance({
	onExit,
	sessionId,
	isActive,
}: {
	onExit: (sessionId: string) => void;
	sessionId: string;
	isActive: boolean;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	// Sync before paint so xterm never sees a stale callback after a render;
	// keeping it in a ref avoids remounting the terminal when the callback changes.
	const onExitRef = useRef(onExit);
	useLayoutEffect(() => {
		onExitRef.current = onExit;
	}, [onExit]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useEffect(() => {
		if (!containerRef.current) return;

		const term = new Terminal({
			fontSize: 13,
			theme: { background: "transparent" },
			cursorBlink: true,
			allowTransparency: true,
		});

		const updateTheme = () => {
			const style = getComputedStyle(document.body);
			const rawForeground = style.color || "#ececec";
			const rawBackground = style.backgroundColor || "#ffffff";

			const foreground = cssColorToRgba(rawForeground);
			const background = cssColorToRgba(rawBackground);

			// Tailwind 4 outputs font-mono or default-mono-font-family
			let fontFamily = style.getPropertyValue("--font-mono").trim();
			if (!fontFamily) {
				fontFamily = style
					.getPropertyValue("--default-mono-font-family")
					.trim();
			}
			if (!fontFamily) fontFamily = "monospace";

			const palette = isDarkTheme() ? DARK_THEME : LIGHT_THEME;

			term.options.fontFamily = fontFamily;
			term.options.theme = {
				...palette,
				background,
				foreground,
				cursor: foreground,
			};
		};

		updateTheme();

		const unsubscribeTheme = subscribeTheme(updateTheme);

		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
		term.open(containerRef.current);

		termRef.current = term;
		fitAddonRef.current = fitAddon;

		term.onData((data) => {
			void desktopApi.terminalWrite(sessionId, data);
		});

		term.onResize(({ cols, rows }) => {
			void desktopApi.terminalResize(sessionId, cols, rows);
		});

		const unsubscribeData = desktopApi.onTerminalData(sessionId, (data) => {
			term.write(data);
		});
		const unsubscribeExit = desktopApi.onTerminalExit(sessionId, () => {
			onExitRef.current(sessionId);
		});

		let fitTimeout: ReturnType<typeof setTimeout>;
		const resizeObserver = new ResizeObserver(() => {
			if (isActive && containerRef.current?.offsetParent !== null) {
				clearTimeout(fitTimeout);
				fitTimeout = setTimeout(() => {
					try {
						fitAddon.fit();
					} catch {
						// Fit might throw if container is hidden/0px
					}
				}, 50);
			}
		});

		resizeObserver.observe(containerRef.current);

		// Initial fit
		// ResizeObserver will handle the initial fit

		return () => {
			clearTimeout(fitTimeout);
			unsubscribeData();
			unsubscribeExit();
			resizeObserver.disconnect();
			unsubscribeTheme();
			term.dispose();
		};
	}, [sessionId]); // Important: only sessionId — anything else here remounts xterm

	useEffect(() => {
		if (
			isActive &&
			fitAddonRef.current &&
			containerRef.current?.offsetParent !== null
		) {
			const fitAddon = fitAddonRef.current;
			const term = termRef.current;
			try {
				fitAddon.fit();
			} catch {
				// Layout may disappear while the debounced fit is running.
			}
			if (!term) return;
			try {
				term.focus();
			} catch {
				// The terminal may be disposed during panel teardown.
			}
		}
	}, [isActive]);

	return <div ref={containerRef} className="w-full h-full" />;
}
