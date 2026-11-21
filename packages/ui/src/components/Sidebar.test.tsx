// @vitest-environment happy-dom

import { act, type ComponentProps, type ReactNode, useState } from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot's render/unmount surface.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar, type SidebarFile } from "./Sidebar";

type Root = {
	render(children: ReactNode): void;
	unmount(): void;
};
type RenameFile = NonNullable<ComponentProps<typeof Sidebar>["onRenameFile"]>;

const roots: Root[] = [];

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	act(() => {
		for (const root of roots) root.unmount();
	});
	roots.length = 0;
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe("Sidebar", () => {
	it("keeps file buttons enabled when drag-and-drop is unavailable", async () => {
		const onSelectFile = vi.fn();
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		roots.push(root);
		act(() =>
			root.render(
				<Sidebar
					files={[{ path: "note.md", modifiedAt: 1 }]}
					currentPath={null}
					sortMode="alpha"
					onSortModeChange={() => {}}
					onSelectFile={onSelectFile}
				/>,
			),
		);
		const button = Array.from(container.querySelectorAll("button")).find(
			(element) => element.textContent === "note.md",
		);
		expect(button).toBeDefined();
		expect(button?.getAttribute("aria-disabled")).not.toBe("true");
		await act(async () => button?.click());
		expect(onSelectFile).toHaveBeenCalledWith("note.md");
	});
	it("expands and collapses all folders from the header toggle", async () => {
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		roots.push(root);
		act(() =>
			root.render(
				<Sidebar
					files={[
						{ path: "/workspace/alpha/middle.md", modifiedAt: 1 },
						{ path: "/workspace/alpha/beta/one.md", modifiedAt: 2 },
					]}
					currentPath={null}
					sortMode="alpha"
					getDisplayPath={(path) => path.replace("/workspace/", "")}
					onSortModeChange={() => {}}
					onSelectFile={() => {}}
				/>,
			),
		);

		// Everything starts collapsed, so the toggle offers expansion.
		expect(allFoldersToggle().getAttribute("aria-label")).toBe(
			"Expand all folders",
		);
		expect(findFileButton("middle.md")).toBeUndefined();

		await act(async () => allFoldersToggle().click());

		expect(allFoldersToggle().getAttribute("aria-label")).toBe(
			"Collapse all folders",
		);
		expect(folderRow("alpha")?.getAttribute("aria-expanded")).toBe("true");
		expect(folderRow("beta")?.getAttribute("aria-expanded")).toBe("true");
		expect(findFileButton("middle.md")).toBeDefined();
		expect(findFileButton("one.md")).toBeDefined();

		await act(async () => allFoldersToggle().click());

		expect(allFoldersToggle().getAttribute("aria-label")).toBe(
			"Expand all folders",
		);
		expect(folderRow("alpha")?.getAttribute("aria-expanded")).toBe("false");
		expect(findFolderRow("beta")).toBeUndefined();
		expect(findFileButton("middle.md")).toBeUndefined();
		expect(findFileButton("one.md")).toBeUndefined();
	});
	it("continues editing after a new note name is submitted", async () => {
		const onRenameFile = vi.fn();
		renderSidebar(onRenameFile);

		await act(async () => newFileButton().click());
		await act(async () => {
			newNoteMenuItem().click();
			await Promise.resolve();
		});

		const input = renameInput("new-file");
		const focusTree = vi.spyOn(sidebarTree(), "focus");
		const frames: FrameRequestCallback[] = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			frames.push(callback);
			return frames.length;
		});
		act(() => {
			setInputValue(input, "daily-notes");
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		act(() => {
			for (const frame of frames) frame(0);
		});

		expect(onRenameFile).toHaveBeenCalledWith(
			"/workspace/new-file.md",
			"daily-notes",
			{ origin: "new-note", commit: "enter" },
		);
		expect(focusTree).not.toHaveBeenCalled();
	});
});

function renderSidebar(onRenameFile: RenameFile) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() => root.render(<SidebarHarness onRenameFile={onRenameFile} />));
}

function SidebarHarness({ onRenameFile }: { onRenameFile: RenameFile }) {
	const [files, setFiles] = useState<SidebarFile[]>([]);
	return (
		<Sidebar
			files={files}
			currentPath={null}
			sortMode="alpha"
			getDisplayPath={(path) => path.replace("/workspace/", "")}
			onSortModeChange={() => {}}
			onSelectFile={() => {}}
			onRenameFile={onRenameFile}
			onCreateFile={async () => {
				const path = "/workspace/new-file.md";
				setFiles([{ path, modifiedAt: 1 }]);
				return path;
			}}
		/>
	);
}

function allFoldersToggle() {
	const button = document.querySelector<HTMLButtonElement>(
		'button[aria-label="Expand all folders"], button[aria-label="Collapse all folders"]',
	);
	if (!button) throw new Error("Missing expand/collapse folders toggle");
	return button;
}

function findFolderRow(label: string) {
	return Array.from(
		document.querySelectorAll<HTMLElement>('[role="treeitem"][aria-expanded]'),
	).find((element) => element.textContent === label);
}

function folderRow(label: string) {
	const row = findFolderRow(label);
	if (!row) throw new Error(`Missing folder row ${label}`);
	return row;
}

function findFileButton(label: string) {
	return Array.from(document.querySelectorAll("button")).find(
		(element) => element.textContent === label,
	);
}

function newFileButton() {
	const button = document.querySelector<HTMLButtonElement>(
		'button[aria-label="New file"]',
	);
	if (!button) throw new Error("Missing new file button");
	return button;
}

function newNoteMenuItem() {
	const item = Array.from(
		document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
	).find((element) => element.textContent?.includes("New Note"));
	if (!item) throw new Error("Missing New Note menu item");
	return item;
}

function sidebarTree() {
	const tree = document.querySelector<HTMLElement>('[role="tree"]');
	if (!tree) throw new Error("Missing sidebar tree");
	return tree;
}

function renameInput(value: string) {
	const input = Array.from(
		document.querySelectorAll<HTMLInputElement>("input"),
	).find((element) => element.value === value);
	if (!input) throw new Error("Missing rename input");
	return input;
}

function setInputValue(input: HTMLInputElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	setter?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}
