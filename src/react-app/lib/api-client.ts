/**
 * Typed HTTP client for Rangkai's `/api` endpoints (docs/06-API-CONTRACT.md).
 *
 * Enforces:
 * - Consistent error envelope parsing (`{ error: { code, message, requestId } }`)
 * - Same-origin cookie credentials (`credentials: "same-origin"`)
 * - Explicit `Content-Type: application/json` for JSON mutations (CSRF requirement)
 * - No false success before server confirmation (NFR-013)
 */

export interface ApiErrorPayload {
	code: string;
	message: string;
	requestId: string;
}

export class ApiClientError extends Error {
	readonly status: number;
	readonly code: string;
	readonly requestId: string;

	constructor(status: number, payload: ApiErrorPayload) {
		super(payload.message);
		this.name = "ApiClientError";
		this.status = status;
		this.code = payload.code;
		this.requestId = payload.requestId;
	}
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
	body?: unknown;
	rawBody?: BodyInit;
}

function isErrorEnvelope(
	value: unknown,
): value is { error: Partial<ApiErrorPayload> } {
	return (
		typeof value === "object" &&
		value !== null &&
		"error" in value &&
		typeof (value as { error: unknown }).error === "object" &&
		(value as { error: unknown }).error !== null
	);
}

export async function apiFetch<TResponse>(
	path: string,
	options: ApiRequestOptions = {},
): Promise<TResponse> {
	const { body, rawBody, headers: customHeaders, ...rest } = options;

	const headers = new Headers(customHeaders);
	if (!headers.has("Accept")) {
		headers.set("Accept", "application/json");
	}

	let requestBody: BodyInit | undefined = rawBody;
	if (body !== undefined) {
		headers.set("Content-Type", "application/json");
		requestBody = JSON.stringify(body);
	}

	let response: Response;
	try {
		const requestInit: RequestInit = {
			...rest,
			headers,
			body: requestBody,
		};
		(requestInit as Record<string, unknown>).credentials = "same-origin";
		response = await fetch(path, requestInit);
	} catch {
		throw new ApiClientError(0, {
			code: "NETWORK_ERROR",
			message:
				"Tidak dapat terhubung ke server. Periksa koneksi jaringan Anda dan coba lagi.",
			requestId: "offline",
		});
	}

	const headerRequestId = response.headers.get("x-request-id") ?? "unknown";
	const contentType = response.headers.get("content-type") ?? "";
	const isJson = contentType.includes("application/json");

	const parsedBody: unknown = isJson
		? await response.json().catch(() => null)
		: null;

	if (!response.ok) {
		if (isErrorEnvelope(parsedBody)) {
			throw new ApiClientError(response.status, {
				code: parsedBody.error.code ?? `HTTP_${response.status}`,
				message:
					parsedBody.error.message ??
					`Permintaan gagal dengan kode HTTP ${response.status}.`,
				requestId: parsedBody.error.requestId ?? headerRequestId,
			});
		}

		throw new ApiClientError(response.status, {
			code: `HTTP_${response.status}`,
			message: `Permintaan gagal diproses oleh server (HTTP ${response.status}).`,
			requestId: headerRequestId,
		});
	}

	return parsedBody as TResponse;
}

export interface HealthResponse {
	status: "ok";
	service: "rangkai";
}

export type EventLifecycleStatus =
	| "draft"
	| "review"
	| "published"
	| "active"
	| "completed"
	| "cancelled"
	| "archived";

export interface EventRecord {
	id: string;
	organizationId: string;
	createdBy: string;
	title: string;
	category?: string | null;
	description?: string | null;
	venueName: string;
	venueLocation?: { type: "Point"; coordinates: [number, number] } | null;
	startsAt: string;
	endsAt: string;
	permitReference?: string | null;
	status: EventLifecycleStatus;
	isSimulation?: boolean;
	publicSlug?: string | null;
	publishedAt?: string | null;
	verifiedBy?: string | null;
	verifiedAt?: string | null;
	cancelledReason?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface PaginatedEventsResponse {
	events: EventRecord[];
	pagination: {
		page: number;
		limit: number;
		total: number;
		totalPages: number;
	};
}

export const api = {
	getHealth: () => apiFetch<HealthResponse>("/api/health"),
	listEvents: (params?: {
		page?: number;
		limit?: number;
		status?: EventLifecycleStatus;
		organizationId?: string;
	}) => {
		const search = new URLSearchParams();
		if (params?.page) search.set("page", String(params.page));
		if (params?.limit) search.set("limit", String(params.limit));
		if (params?.status) search.set("status", params.status);
		if (params?.organizationId) search.set("organizationId", params.organizationId);
		const queryString = search.toString();
		return apiFetch<PaginatedEventsResponse>(
			`/api/events${queryString ? `?${queryString}` : ""}`,
		);
	},
	getEvent: (eventId: string) =>
		apiFetch<{ event: EventRecord }>(`/api/events/${encodeURIComponent(eventId)}`),
};
