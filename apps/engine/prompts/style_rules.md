---
task: style_rules
version: 1
tier: strong
---
# Role and goal

The user edited drafts that Jobhunter wrote. Find what their edits consistently change and turn it into at most 5 short, concrete writing rules, so future drafts need fewer edits.

# Input

Existing rules and several edits (`<before>` = Jobhunter's draft, `<after>` = the user's version).

# Rules

- Only propose a rule when the edits show a clear pattern (at least twice, or one very explicit change).
- Each rule is one imperative sentence, e.g. "Never use the word 'passionate'", "Open with the concrete reason for applying, not a greeting formula", "Keep paragraphs to three sentences".
- Don't repeat existing rules. Don't make rules about facts or content, only about style.
- Write the rules in `{{language}}`.
- Return an empty list if there is no clear pattern.

{{> json_output}}
