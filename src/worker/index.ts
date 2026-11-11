import { Hono } from "hono";
import { getDb } from "../db/index";
import { AuthConfigError, createAuth } from "./auth";
import { formatErrorEnvelope } from "./lib/errors";
import { csrfAndOriginProtection } from "./middleware/csrf";
import { rateLimit } from "./middleware/rate-limit";
import { assignmentsRouter } from "./routes/assignments";
import { cleanupRouter } from "./routes/cleanup";
import { documentsRouter } from "./routes/documents";
import { eventsRouter } from "./routes/events";
import { extractionsRouter } from "./routes/extractions";
import { publicRouter } from "./routes/public";
import { publicAssistantRouter } from "./routes/public-assistant";
import { roadsRouter } from "./routes/roads";
import { organizationsRouter } from "./routes/organizations";
import { invitationsRouter } from "./routes/invitations";
import { fieldRouter } from "./routes/field";
import { advisoryRouter } from "./routes/advisory";
import { alternativeRoutesRouter } from "./routes/alternative-routes";
import type { AppVariables, Env } from "./types";

declare global {
	interface Env {
		DATABASE_URL?: string;
		DATABASE_URL_UNPOOLED?: string;
		BETTER_AUTH_SECRET?: string;
		BETTER_AUTH_URL?: string;
		rangkai_documents_dev?: R2Bucket;
		GEMINI_API_KEY?: string;
		GEMINI_MODEL?: string;
		AI_REQUEST_TIMEOUT_MS?: string;
		AI_IMPACT_PLANNER_ENABLED?: string;
		AI_NOTICE_GENERATOR_ENABLED?: string;
		AI_WASTE_PLANNER_ENABLED?: string;
		NETWORK_ROUTING_ENABLED?: string;
		PUBLIC_ASSISTANT_ENABLED?: string;
		ORS_API_KEY?: string;
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
	const rawHeaderId = c.req.header("x-request-id")?.trim();
	const requestId =
		rawHeaderId &&
		rawHeaderId.length >= 1 &&
		rawHeaderId.length <= 64 &&
		/^[A-Za-z0-9._-]+$/.test(rawHeaderId)
			? rawHeaderId
			: crypto.randomUUID();
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

// Rate limiting on sensitive auth endpoints (Ticket 01, SRS FR-070–072)
app.use(
	"/api/auth/sign-up/*",
	rateLimit({ windowMs: 60 * 1000, max: 10, keyPrefix: "auth-signup" }),
);
app.use(
	"/api/auth/sign-in/*",
	rateLimit({ windowMs: 60 * 1000, max: 20, keyPrefix: "auth-signin" }),
);

// Better Auth owns /api/auth/* (docs/06-API-CONTRACT.md §3)
app.all("/api/auth/*", async (c) => {
	const auth = c.get("auth");
	return auth.handler(c.req.raw);
});

// Mount Public API routes (anonymous read-only access)
app.route("/api/public/assistant", publicAssistantRouter);
app.route("/api/public", publicRouter);
// Invitation inspection is anonymous; its mutation and listing handlers enforce authentication.
app.route("/api/invitations", invitationsRouter);

// Mount A05-A08 routers
app.route("/api/events", documentsRouter);
app.route("/api", extractionsRouter);
app.route("/api", roadsRouter);
app.route("/api", cleanupRouter);
app.route("/api", advisoryRouter);
app.route("/api", alternativeRoutesRouter);

// Mount Events and Assignments routes
app.route("/api/events", assignmentsRouter);
app.route("/api/events", eventsRouter);
app.route("/api/organizations", organizationsRouter);
app.route("/api/field", fieldRouter);

// 404 handler for API routes
app.notFound((c) => {
	const requestId = c.get("requestId") || "unknown";
	return c.json(
		formatErrorEnvelope(
			"NOT_FOUND",
			"Resource not found or not visible.",
			requestId,
		),
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
