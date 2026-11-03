import { defineConfig } from "drizzle-kit";
import { resolveDatabaseUrl } from "./src/db/guard";

// ponytail: fail-closed configuration resolution preventing empty or ambient URL migration attempts
const rawUrl = resolveDatabaseUrl();
const dbUrl =
	process.env.DATABASE_URL_UNPOOLED ||
	rawUrl.replace("-pooler.", ".");

export default defineConfig({
	schema: ["./src/db/auth-schema.ts", "./src/db/schema/index.ts"],
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: {
		url: dbUrl,
	},
});
