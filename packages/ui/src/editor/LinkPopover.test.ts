// @vitest-environment happy-dom

import { LinkExtension } from "@marky/editor";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { act, createElement, type ReactNode } from "react";
// @ts-expect-error This package does not ship @types/react-dom; the test only
// needs createRoot's render/unmount surface.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkPopover, visitActiveLink } from "./LinkPopover";
import { SmartLinkExtension } from "./SmartLinkExtension";

type Root = {
	render(children: ReactNode): void;
	unmount(): void;
};

const editors: Editor[] = [];
const roots: Root[] = [];

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom may not implement Element.animate; the popover's preview reveal
// only needs a no-op animation handle.
if (!("animate" in Element.prototype)) {
	Object.defineProperty(Element.prototype, "animate", {
		configurable: true,
		writable: true,
		value: () => ({
			addEventListener() {},
			cancel() {},
		}),
	});
}

afterEach(() => {
	act(() => {
		for (const root of roots) root.unmount();
	});
	roots.length = 0;
	for (const editor of editors) editor.destroy();
	editors.length = 0;
	document.body.replaceChildren();
});

describe("visitActiveLink", () => {
	it("passes explicit wiki target extensions through unchanged", async () => {
		const onOpenWikiLink = vi.fn();

		await visitActiveLink(
			{ href: "manual.pdf", kind: "wiki", target: "manual.pdf" },
			vi.fn(),
			onOpenWikiLink,
		);

		expect(onOpenWikiLink).toHaveBeenCalledWith("manual.pdf");
	});
});

describe("LinkPopover paste", () => {
	it("replaces the clipboard-autofilled URL when the user pastes", async () => {
		const { editor, input } = await renderAutofilledPopover();

		const pasteEvent = makePasteEvent("https://other.example.org/page");
		await act(async () => {
			input.dispatchEvent(pasteEvent);
		});

		expect(pasteEvent.defaultPrevented).toBe(true);
		expect(input.value).toBe("https://other.example.org/page");
		expect(linkHref(editor)).toBe("https://other.example.org/page");
	});

	it("keeps native paste behavior once the user edits the autofilled URL", async () => {
		const { input } = await renderAutofilledPopover();

		await act(async () => {
			setReactInputValue(input, "https://example.com/edit");
		});

		const pasteEvent = makePasteEvent("https://other.example.org/page");
		await act(async () => {
			input.dispatchEvent(pasteEvent);
		});

		expect(pasteEvent.defaultPrevented).toBe(false);
		expect(input.value).toBe("https://example.com/edit");
	});
});

// ── Helpers ─────────────────────────────────────────────────────────

async function renderAutofilledPopover() {
	const editor = createEditor();
	const viewport = document.createElement("div");
	viewport.append(editor.view.dom);
	document.body.append(viewport);
	renderPopover(editor, viewport);

	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { readText: async () => "https://example.com/" },
	});

	// Select text and toggle a link, like the Cmd+K shortcut does: the
	// extension fires FOCUS_LINK_POPOVER_EVENT and the popover autofills the
	// clipboard URL asynchronously, after the input was focused and selected.
	await act(async () => {
		editor.commands.setTextSelection({ from: 1, to: 12 });
		editor.commands.toggleLinkAtSelection();
	});
	await act(async () => {
		await new Promise((resolve) => window.setTimeout(resolve, 0));
	});

	const input = document.querySelector<HTMLInputElement>('input[type="text"]');
	expect(input).toBeInstanceOf(HTMLInputElement);
	expect(input?.value).toBe("https://example.com/");
	if (!input) throw new Error("link input not rendered");
	return { editor, input };
}

function createEditor() {
	const editor = new Editor({
		element: document.createElement("div"),
		// StarterKit v3 bundles its own link mark; use Marky's instead.
		extensions: [
			StarterKit.configure({ link: false }),
			LinkExtension,
			SmartLinkExtension,
		],
		content: {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "hello world" }],
				},
			],
		},
	});
	editors.push(editor);
	return editor;
}

function renderPopover(editor: Editor, viewport: HTMLDivElement) {
	const rootEl = document.createElement("div");
	viewport.append(rootEl);
	const root = createRoot(rootEl);
	roots.push(root);
	act(() => {
		root.render(
			createElement(LinkPopover, {
				editor,
				containerRef: { current: viewport },
				viewportRef: { current: viewport },
				wikiTargets: [],
				onOpenExternalLink: vi.fn(),
				onOpenWikiLink: vi.fn(),
			}),
		);
	});
}

function makePasteEvent(text: string) {
	const event = new Event("paste", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "clipboardData", {
		value: { getData: () => text },
	});
	return event;
}

function setReactInputValue(input: HTMLInputElement, value: string) {
	// React overrides the value setter on the element; go through the prototype
	// setter so React's onChange sees the update.
	const setter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	setter?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

function linkHref(editor: Editor) {
	const mark = editor.state.doc
		.nodeAt(1)
		?.marks.find((mark) => mark.type.name === "link");
	return mark?.attrs.href as string | undefined;
}
