import * as dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

// ponytail: load .dev.vars for local development migrations without leaking secrets
dotenv.config({ path: ".dev.vars" });

const dbUrl =
	process.env.DATABASE_URL_UNPOOLED ||
	(process.env.DATABASE_URL
		? process.env.DATABASE_URL.replace("-pooler.", ".")
		: "");

export default defineConfig({
	schema: ["./src/db/auth-schema.ts", "./src/db/schema/index.ts"],
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: {
		url: dbUrl,
	},
});
