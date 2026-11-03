import { Hono } from "hono";
const app = new Hono<{ Bindings: Env }>();

// ponytail: deterministic process liveness check, no external dependency probing
app.get("/api/health", (c) =>
	c.json({
		status: "ok",
		service: "rangkai",
	}),
);

app.get("/api/", (c) => c.json({ name: "Cloudflare" }));

export default app;
