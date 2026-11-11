# Native Orca engineering workflow

Use native model selection and verify the requested and effective model in the launch receipt.

1. Scope work from existing requirements and dispatch bounded slices with explicit ownership and acceptance criteria. Use `gpt-6.1-terra` Low for implementation, integration, documentation, focused fixes and ordinary independent checks.
2. Escalate only a concrete ambiguous architecture, security or runtime boundary, or two distinct focused attempts reproducing the same unresolved failure, to Terra Medium. Return routine work to Low.
3. Preserve other work, use relevant provider documentation and guarded development resources, and verify changed behavior and security. Record commands, tested SHA and limitations; reuse sufficient evidence.
4. Integrate the requested batch before review. Reserve an independent `gpt-6.1-sol` High audit for rare frozen milestones, releases or serious unresolved security issues. Keep standards and specification findings separate.
5. Consolidate material findings into one Terra Low repair pass, followed by narrow closure checks. Repeat broad review only when new risky changes or failures justify it.
6. Use native notifications and handoffs without polling. Preserve secrets and domain invariants; merge, push, deployment and production changes require applicable authorization and gates. Report external acceptance separately from software verification.

Model selection: https://developers.openai.com/api/docs/guides/model-selection. Reasoning effort: https://developers.openai.com/api/docs/guides/reasoning. API model catalog: https://developers.openai.com/api/docs/models. API token prices do not establish Orca or Codex subscription usage, quota or savings.
