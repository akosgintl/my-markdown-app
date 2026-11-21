/**
 * Helpers for the image context menu and the marky-asset URLs its items
 * resolve. `assetPathFromUrl` is shared with the marky-asset protocol handler
 * in main.ts, which serves the files these URLs point at.
 */
export function assetPathFromUrl(url: URL): string {
	const queryPath = url.searchParams.get("path");
	if (queryPath) return queryPath;
	const encodedPath = url.pathname.startsWith("/")
		? url.pathname.slice(1)
		: url.pathname;
	return decodeURIComponent(encodedPath);
}

export type ImageAddressItem = {
	label: "Copy Image Path" | "Copy Image Address";
	value: string;
};

/**
 * The address item of the image context menu. Workspace images load from
 * marky-asset URLs that wrap a filesystem path, so offer that path; anything
 * else (https, data, …) only has an address.
 */
export function imageAddressItem(srcUrl: string): ImageAddressItem {
	if (srcUrl.startsWith("marky-asset:")) {
		try {
			return {
				label: "Copy Image Path",
				value: assetPathFromUrl(new URL(srcUrl)),
			};
		} catch {
			// Malformed asset URL; copy it verbatim below.
		}
	}
	return { label: "Copy Image Address", value: srcUrl };
}
