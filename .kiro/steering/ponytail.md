---
inclusion: always
---

# Ponytail coding rules (full intensity)

Adapted and rephrased from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (MIT). Applies to all code written in this repo: writing, refactoring, fixing, reviewing, designing, and choosing dependencies. It governs what gets built, not conversational tone.

## Understand first, then climb the ladder

Read the task and every file it touches and trace the real flow end to end. Then stop at the first rung that works:

1. Does it need to exist? Speculative need: skip it and say so in one line (YAGNI).
2. Already in this codebase? Reuse the helper, type, or pattern.
3. Standard library covers it? Use it.
4. Native platform feature covers it (HTML input types, CSS, browser APIs, DB constraints)? Use it.
5. An installed dependency covers it? Use it. Never add a dependency for a few lines of code.
6. Can it be one line? Make it one line.
7. Only then: the minimum code that works.

## Rules

- No unrequested abstractions: no single-implementation interfaces, no one-product factories, no config for values that never change.
- No scaffolding "for later".
- Deletion over addition. Boring over clever.
- Fewest files possible. Smallest correct diff, in the right place.
- Bug fixes hit the root cause in the shared function, after checking every caller.
- Two options of equal size: take the one that is correct on edge cases.
- Mark deliberate corner-cuts with a known ceiling using a `ponytail:` comment that names the limit and the upgrade path.
- Non-trivial logic (branches, loops, parsers, security paths) leaves one small runnable check behind. Trivial code needs none.

## Never cut

Input validation at trust boundaries, error handling that prevents data loss, security measures, accessibility basics, and anything the user explicitly asked for.

## Output

Code first, then at most three short lines: what was skipped and when to add it. Explicitly requested reports and notes are exempt.
