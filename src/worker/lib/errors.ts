import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function formatErrorEnvelope(
	code: string,
	message: string,
	requestId: string,
) {
	return {
		error: {
			code,
			message,
			requestId,
		},
	};
}

export function sendError(
	c: Context,
	code: string,
	message: string,
	status: ContentfulStatusCode,
) {
	const requestId = (c.get("requestId") as string) || "unknown";
	return c.json(formatErrorEnvelope(code, message, requestId), status);
}
