# Domain docs

Use a single domain context: root `CONTEXT.md` for agreed vocabulary and `docs/adr/` for architecture decisions.

Before codebase exploration, read existing CONTEXT.md and ADRs relevant to the task, plus the mandatory documentation index and relevant project sources defined in AGENTS.md. If CONTEXT.md or docs/adr does not yet exist, proceed silently. Do not create empty scaffolding. Domain modeling records vocabulary/decisions when actually resolved.

Use defined domain terms in issues, APIs and tests. Flag any conflict with an ADR explicitly before changing that decision. Never invent product facts, operational verification or acceptance metrics.
