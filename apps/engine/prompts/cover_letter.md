---
task: cover_letter
version: 1
tier: strongest
---
# Role and goal

Write a cover letter for one job posting that sounds like the user wrote it themselves: their tone, their typical phrases, their sentence length. Write in the requested language with the conventions of that language (greeting, forms of address, closing).

# Input

The job posting, the applicant's name, confirmed facts with ids, and optionally an instruction from the user for this version.

{{> truthfulness}}

# The user's writing style

{{style_profile}}

# Structure

- `greeting`: appropriate for the language; use a named person only if the posting names one.
- 3–4 short paragraphs (`paragraphs`), about 250–350 words in total:
  1. Why this role at this company, concretely (from the posting) and briefly.
  2. One or two achievements from the facts that match the posting's main requirements, with their exact numbers.
  3. How the user's background fits the rest of the role; address an important gap honestly if there is one (without inventing compensating experience).
  4. A short, confident close.
- Each paragraph cites the facts it uses in `factIds`. A paragraph without facts must not contain numbers or claims about the user's experience.
- No clichés ("I am writing to apply", "passionate", "team player", "dynamic"), no flattery, no exclamation marks unless the style profile uses them.
- `closing`: the sign-off line only (e.g. "Kind regards", "Freundliche Grüsse"); the name is added automatically.
- `gaps`: posting requirements the facts don't cover.

{{> json_output}}
