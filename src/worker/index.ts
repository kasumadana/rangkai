import { Hono } from "hono";
import { getDb } from "../db/index";
import { createAuth } from "./auth";
import { formatErrorEnvelope } from "./lib/errors";
import { assignmentsRouter } from "./routes/assignments";
import { eventsRouter } from "./routes/events";
import type { AppVariables, Env } from "./types";

declare global {
	interface Env {
		DATABASE_URL?: string;
		DATABASE_URL_UNPOOLED?: string;
		BETTER_AUTH_SECRET?: string;
		BETTER_AUTH_URL?: string;
	}
}

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Deterministic process liveness check - zero external dependencies (AGENTS.md, docs/06-API-CONTRACT.md §11)
app.get("/api/health", (c) =>
	c.json({
		status: "ok",
		service: "rangkai",
	}),
);

app.get("/api/", (c) => c.json({ name: "Cloudflare" }));

// Request context middleware: assigns requestId, db client, and auth instance for API operations
app.use("/api/*", async (c, next) => {
	const requestId =
		c.req.header("x-request-id") || crypto.randomUUID();
	c.set("requestId", requestId);

	const dbUrl = c.env?.DATABASE_URL || (typeof process !== "undefined" ? process.env?.DATABASE_URL : undefined);
	const db = getDb(dbUrl);
	c.set("db", db);

	const auth = createAuth(db, c.env);
	c.set("auth", auth);

	c.header("x-request-id", requestId);
	await next();
});

// Better Auth owns /api/auth/* (docs/06-API-CONTRACT.md §3)
app.all("/api/auth/*", async (c) => {
	const auth = c.get("auth");
	return auth.handler(c.req.raw);
});

// Mount Events and Assignments routes
app.route("/api/events", assignmentsRouter);
app.route("/api/events", eventsRouter);

// 404 handler for API routes
app.notFound((c) => {
	const requestId = c.get("requestId") || "unknown";
	return c.json(
		formatErrorEnvelope("NOT_FOUND", "Resource not found or not visible.", requestId),
		404,
	);
});

// Global error handler: never leak stack traces or internal secrets to clients
app.onError((err, c) => {
	const requestId = c.get("requestId") || "unknown";
	return c.json(
		formatErrorEnvelope(
			"INTERNAL_SERVER_ERROR",
			"An unexpected error occurred while processing the request.",
			requestId,
		),
		500,
	);
});

export default app;
