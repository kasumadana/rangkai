# Native Orca engineering workflow

| Role | Agent/model | Responsibility |
| --- | --- | --- |
| Coordinator | Codex GPT 6.1 Sol High | Scope, ticket dependencies, native dispatch, decisions, concise status |
| Executor | Codex GPT 6.1 Terra High | Implementation, fixes, tests, fixtures and documentation |
| Independent auditor | Codex GPT 6.1 Sol High | Standards/Spec review and targeted verification; complex analysis, no implementation fixes |

1. Read existing requirements. Use ask-matt to route work; clarify only unresolved scope. Use to-spec only if existing sources lack a coherent specification, then to-tickets for self-contained vertical slices and true blocking edges. Obtain required scope approval once.
2. Dispatch one Terra High writer in a native Orca child worktree with explicit native model selection. Verify receipt model. Keep implementation out of the auditor context. Model changes require a model-selectable launch; terminal reuse cannot switch model. The coordinator handles short tasks directly.
3. Executor uses implement, Ponytail Full and behavior-focused tdd at agreed API boundaries, current official provider docs, branch-guarded development resources, and per-task typecheck/lint/integration/security checks. Never skip security/error behavior to save tokens.
4. Implement the ENTIRE user-requested batch before formal review. Execute required combined regression/runtime checks and document exact commands, exits, actual counts, tested final SHA and limits. Finish source/docs/fixtures before reporting once; no later candidate edits during audit.
5. Launch independent Sol High audit in an isolated snapshot at final SHA. Keep Standards and Spec findings separate. Reuse sufficient evidence and run targeted checks for gaps; do not repeat broad review or full suites without changed code/failure/gaps justifying it.
6. Return consolidated actionable findings to Terra High. Verify only their closure and changed-path regressions against a new pin. Auditor never implements fixes. Report software/runtime acceptance separately from user-deferred external data acceptance.
7. Use native ask/reply and notifications. After dispatch end the turn; no polling/watch scripts. Self-contained tickets/reports preserve context; hand off at phase boundaries only when needed. Record exact current task/dispatch IDs and report once.
8. Keep source/secrets private, preserve other contributors' changes and domain invariants. Merge/push/deploy require applicable user authorization and proven gates; never infer acceptance from silence or successful task lifecycle alone. Do not fake official government or Dishub identifiers: pending release gate is exact authorized pilot org identity/provenance supplied by owner.

Supporting skills: orchestration/orca-cli for workers/worktrees, wrangler for Cloudflare operations, code-review for review criteria, diagnosing-bugs for hard failures, git-commit for authorized commits. Triage applies to incoming raw issues, not tickets already produced by to-tickets.
