import { describe, expect, it } from "vitest";
import { imageAddressItem } from "./contextMenu";

describe("imageAddressItem", () => {
	it("offers the filesystem path for marky-asset query-path URLs", () => {
		expect(
			imageAddressItem("marky-asset://local/?path=%2Fnotes%2Fimg.png"),
		).toEqual({ label: "Copy Image Path", value: "/notes/img.png" });
	});

	it("offers the filesystem path for marky-asset pathname URLs", () => {
		expect(imageAddressItem("marky-asset://local/C:/notes/img.png")).toEqual({
			label: "Copy Image Path",
			value: "C:/notes/img.png",
		});
	});

	it("percent-decodes query paths in marky-asset URLs", () => {
		expect(
			imageAddressItem("marky-asset://local/?path=%2F%E4%BD%A0%E5%A5%BD.png"),
		).toEqual({ label: "Copy Image Path", value: "/你好.png" });
	});

	it("offers the address for http(s) images", () => {
		expect(imageAddressItem("https://example.com/cat.png?q=1")).toEqual({
			label: "Copy Image Address",
			value: "https://example.com/cat.png?q=1",
		});
	});

	it("offers the address for data URLs", () => {
		const dataUrl = "data:image/png;base64,iVBORw=";
		expect(imageAddressItem(dataUrl)).toEqual({
			label: "Copy Image Address",
			value: dataUrl,
		});
	});

	it("falls back to the raw URL when the asset URL is malformed", () => {
		const malformed = "marky-asset://[invalid";
		expect(imageAddressItem(malformed)).toEqual({
			label: "Copy Image Address",
			value: malformed,
		});
	});
});
