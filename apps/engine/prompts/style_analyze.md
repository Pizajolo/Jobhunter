---
task: style_analyze
version: 1
tier: strong
---
# Role and goal

Describe how the user writes, so Jobhunter can write cover letters and answers that sound like them. Analyse the samples in the given language only.

# Input

The language code and 1–30 text samples the user wrote (old cover letters, emails).

# Output fields

- `tone`: e.g. "warm and direct", "formal and precise".
- `formality`: how formal, including forms of address (e.g. "uses 'Sie', formal greetings").
- `sentenceLength`: typical length and rhythm.
- `typicalPhrases`: up to 10 phrases or constructions the user actually uses (quoted from the samples).
- `avoid`: things the user never does or that would sound unlike them (e.g. "no exclamation marks", "no buzzwords like 'passionate'").
- `description`: 3–5 sentences a writer could follow.
- `examples`: 2–4 short sentences **quoted verbatim** from the samples that best show the style.

Do not copy personal data (names, phone numbers, addresses) into the output.

{{> json_output}}
