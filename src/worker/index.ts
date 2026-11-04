import { Hono } from "hono";
import { getDb } from "../db/index";
import { AuthConfigError, createAuth } from "./auth";
import { formatErrorEnvelope } from "./lib/errors";
import { csrfAndOriginProtection } from "./middleware/csrf";
import { assignmentsRouter } from "./routes/assignments";
import { cleanupTasksRouter, eventsCleanupRouter } from "./routes/cleanup";
import { documentsRouter } from "./routes/documents";
import { eventsRouter } from "./routes/events";
import {
	eventsExtractionsRouter,
	extractionsRouter,
} from "./routes/extractions";
import { publicRouter } from "./routes/public";
import {
	roadImpactsRouter,
	roadSegmentsRouter,
	roadStatusRouter,
} from "./routes/roads";
import type { AppVariables, Env } from "./types";

declare global {
	interface Env {
		DATABASE_URL?: string;
		DATABASE_URL_UNPOOLED?: string;
		BETTER_AUTH_SECRET?: string;
		BETTER_AUTH_URL?: string;
		rangkai_documents_dev?: R2Bucket;
		GEMINI_API_KEY?: string;
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
	c.header("x-request-id", requestId);

	const dbUrl =
		c.env && "DATABASE_URL" in c.env
			? c.env.DATABASE_URL
			: typeof process !== "undefined"
				? process.env?.DATABASE_URL
				: undefined;

	if (!dbUrl || typeof dbUrl !== "string" || dbUrl.trim().length === 0) {
		return c.json(
			formatErrorEnvelope(
				"DEPENDENCY_UNAVAILABLE",
				"Database configuration is missing. Service is unavailable.",
				requestId,
			),
			503,
		);
	}

	let db;
	try {
		db = getDb(dbUrl);
	} catch {
		return c.json(
			formatErrorEnvelope(
				"DEPENDENCY_UNAVAILABLE",
				"Database connection could not be established.",
				requestId,
			),
			503,
		);
	}
	c.set("db", db);

	let auth;
	try {
		auth = createAuth(db, c.env);
	} catch {
		return c.json(
			formatErrorEnvelope(
				"DEPENDENCY_UNAVAILABLE",
				"Authentication service configuration is missing or invalid.",
				requestId,
			),
			503,
		);
	}
	c.set("auth", auth);

	await next();
});

// Enforce CSRF and Origin protection on cookie-authenticated / mutating application routes
app.use("/api/*", csrfAndOriginProtection);

// Better Auth owns /api/auth/* (docs/06-API-CONTRACT.md §3)
app.all("/api/auth/*", async (c) => {
	const auth = c.get("auth");
	return auth.handler(c.req.raw);
});

// Mount Public API routes (anonymous read-only access)
app.route("/api/public", publicRouter);

// Mount Road Segments catalog router
app.route("/api/road-segments", roadSegmentsRouter);

// Mount Live Road Status updates router
app.route("/api/road-impacts", roadStatusRouter);

// Mount Cleanup Tasks direct router
app.route("/api/cleanup-tasks", cleanupTasksRouter);

// Mount Extractions detail router
app.route("/api/extractions", extractionsRouter);

// Mount Events-scoped routers (Cleanup, Documents, Extractions, Road Impacts, Assignments, Events)
app.route("/api/events", eventsCleanupRouter);
app.route("/api/events", documentsRouter);
app.route("/api/events", eventsExtractionsRouter);
app.route("/api/events", roadImpactsRouter);
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

	if (
		err instanceof AuthConfigError ||
		err.message?.includes("DATABASE_URL") ||
		err.message?.includes("fetch failed") ||
		err.message?.includes("connection")
	) {
		return c.json(
			formatErrorEnvelope(
				"DEPENDENCY_UNAVAILABLE",
				"Upstream dependency service is temporarily unavailable.",
				requestId,
			),
			503,
		);
	}

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
