# JDCAGNET Project Instructions

## JDC Context Engine Hard Contract

All future `JDC Context Engine` implementation must avoid local artificial capacity limits.

- Do not add default token caps for Engine bundles, sections, code context, project docs, accepted memory, or same-project fact loading.
- Do not reintroduce legacy defaults such as `2500`, `700`, `900`, or provider-side memory caps such as `50`.
- Do not summarize, truncate, or drop Engine context because of local token budgeting.
- Selection belongs to relevance, freshness, citations, and protocol safety, not a hidden product-wide size ceiling.
- If a provider/model rejects an oversized request, handle it in a protocol-safe adapter fallback with diagnostics. Do not hide a small cap in the Engine.

This is a project-level memory and engineering constraint. Keep comments and tests near Engine code so future maintainers do not accidentally weaken it.
