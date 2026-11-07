const PRELOADER_SESSION_KEY = "rangkai:preloader-shown";

export function shouldPlayPreloader(key: string = "landing"): boolean {
	if (typeof window === "undefined") return false;
	try {
		const navEntries = performance.getEntriesByType?.(
			"navigation",
		) as PerformanceNavigationTiming[];
		const isHardReload = navEntries?.[0]?.type === "reload";
		const storageKey =
			key === "landing"
				? PRELOADER_SESSION_KEY
				: `${PRELOADER_SESSION_KEY}:${key}`;
		const alreadyShown =
			window.sessionStorage.getItem(storageKey) === "1";
		return isHardReload || !alreadyShown;
	} catch {
		return false;
	}
}

export function markPreloaderShown(key: string = "landing"): void {
	if (typeof window !== "undefined") {
		try {
			const storageKey =
				key === "landing"
					? PRELOADER_SESSION_KEY
					: `${PRELOADER_SESSION_KEY}:${key}`;
			window.sessionStorage.setItem(storageKey, "1");
		} catch {
			// ignore storage errors
		}
	}
}
