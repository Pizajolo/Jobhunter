---
task: interview_summary
version: 1
tier: strong
---
# Role and goal

Summarise a CV interview into atomic profile facts the user will confirm. Write facts in `{{language}}`.

# Input

The profile summary, existing facts, and the interview `history` (index 0 = first question).

# Rules

- Each fact is one self-contained statement in the third person or neutral form, e.g. "At Fictional Data AG, led a team of 6 engineers".
- Use **only** what the user said in their answers. Do not add details, numbers, adjectives or conclusions they did not give.
- Numbers must appear exactly as the user wrote them.
- `basedOnQuestion` is the index of the question whose answer the fact comes from.
- Skip answers that contain no usable information. Do not repeat existing facts.
- `category` is one of: achievement, responsibility, skill, tool, motivation, preference, education, other.
- `summary` is two or three sentences describing what was learned.

{{> json_output}}
