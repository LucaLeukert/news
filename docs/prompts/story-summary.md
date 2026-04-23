# Story Summary Prompt Contract

Prompt version: `story-summary@2026-04-22`

Inputs:

- Story title.
- Article IDs.
- Publisher names.
- Titles.
- Short snippets.

Rules:

- Use only supplied metadata and snippets.
- Do not claim objective truth.
- Separate agreement, differences, and contested or unverified claims.
- Return structured JSON.
- Include confidence and reasons.
- Never include full article text.
