# Grounded AI Assistant Responses

**Date:** 2026-11-13  
**Status:** Design selected by user; written specification pending review  
**Scope:** Public and authenticated modes of the shared assistant widget

## Problem

The widget reaches Gemini, but Gemini only classifies the question and selects source IDs. Its prompt explicitly says not to answer. The API then returns short, fixed server-authored sentences, so replies often fail to address the user's wording even when relevant facts are available.

## Goal

Give concise, clear Indonesian answers that address the question using only current Rangkai facts the requester may access. Missing, stale, ambiguous, unsupported, or out-of-scope information must produce an explicit abstention instead of a guess.

## Selected approach

Use Gemini to draft a short answer from a bounded packet of server-retrieved facts, then validate the response before returning it. This is more conversational than fixed templates while keeping the data boundary in the server.

The system must not claim that generated prose is guaranteed hallucination-free. Structural validation and source binding reduce risk but cannot prove every natural-language sentence. If an answer cannot be tied to retrieved facts, the server must abstain or use a server-authored fallback.

## Request and answer flow

1. Validate the question and establish its scope. Public requests can use only public event, road, cleanup, and reviewed help data. Authenticated requests must retain existing membership, event assignment, category permission, and repeated session checks.
2. Classify the question and retrieve only bounded facts needed to answer it. Do not send private documents, credentials, contact details, user identity, arbitrary URLs, or unrelated records to Gemini.
3. Send Gemini the question and the retrieved fact packet. Treat the question and all database strings as untrusted data, not instructions. Require a strict JSON response containing a concise answer, disposition (`answered` or `abstained`), and cited source IDs. Do not accept model-provided URLs.
4. Validate the JSON schema, answer length, disposition, every source ID against the packet, and that each cited source is still valid for this request. Reject malformed or unknown references. Preserve stale-road, simulation, authority, privacy, and routing caveats from server-owned facts.
5. Return server-authored source cards and links. If Gemini fails, returns unsupported data, or selects no sufficient evidence, return an honest Indonesian abstention or server-authored fallback. Never fabricate facts to fill gaps.

## Answer boundaries

- Answers cover Rangkai event logistics and reviewed help only; they do not answer unrelated general questions.
- Road observations past their expiry remain unconfirmed. An open status does not mean a road is uncongested.
- Rangkai does not grant permits or guarantee a route is legal, safe, or free of congestion.
- Simulation records remain visibly identified as simulations.
- Public answers never reveal private organization data, officer contact information, credentials, or uploaded documents.
- The authenticated endpoint retains its existing server-side authorization checks before provider use and before returning results.
- The feature flag remains the operator's control. This design does not enable the assistant in production or change secrets/configuration.

## Failure behavior

- Provider timeout, invalid JSON, invalid source reference, or missing configuration: return the existing unavailable/error envelope or a clearly labeled safe fallback; do not present an invented answer as successful.
- No relevant facts or unsupported intent: abstain and direct the user to the relevant public page or authorized workflow.
- Permission or context changes during generation: preserve existing denial/context-changed behavior and return no retrieved facts.

## Validation plan

- Unit coverage for response schema validation, unknown/duplicate source IDs, unsupported claims handling, stale facts, simulations, and safe fallback behavior.
- Route tests for public and authenticated scope, permissions before and after provider generation, provider failure, and answer/source consistency.
- Update the 20-case assistant evaluation suite in `docs/05-AI-SPEC.md`; adversarial, private-data, stale-status, and out-of-scope cases must abstain or use only approved evidence.
- Manually inspect representative Indonesian responses for event lookup, road status, cleanup, help, missing facts, and route-safety questions.

## Documentation changes during implementation

Update the public assistant contract in `docs/05-AI-SPEC.md`, `docs/06-API-CONTRACT.md`, and `docs/08-SECURITY-OPS.md` so they describe the selected generation-and-validation flow, its remaining model risk, and the unchanged enablement gate. Keep response schemas and failure behavior consistent across both assistant endpoints.

## Non-goals

- No chatbot layout or widget redesign.
- No general-purpose internet search, arbitrary knowledge answering, conversation memory, or user profiling.
- No access to private uploaded documents or changes to routing, operational status, or permissions.
- No claim of zero hallucination or traffic safety guarantee.
