import { QueryClient } from "@tanstack/react-query";
import { ApiClientError } from "./api-client";

/**
 * Shared TanStack Query client configured per docs/03-ARCHITECTURE.md §8:
 * - Active public views poll every 30s at the query level (`PUBLIC_POLL_INTERVAL_MS`).
 * - Do not retry 400/401/403/404/409/422 client/auth errors.
 * - Never show optimistic fake success before server confirmation.
 */
export const PUBLIC_POLL_INTERVAL_MS = 30_000;

export function createAppQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 15_000,
				refetchOnWindowFocus: true,
				retry: (failureCount, error) => {
					if (error instanceof ApiClientError) {
						if (
							error.status === 400 ||
							error.status === 401 ||
							error.status === 403 ||
							error.status === 404 ||
							error.status === 409 ||
							error.status === 422
						) {
							return false;
						}
					}
					return failureCount < 2;
				},
			},
			mutations: {
				retry: false,
			},
		},
	});
}
