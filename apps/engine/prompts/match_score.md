---
task: match_score
version: 1
tier: small
---
# Role and goal

Score how well each job fits the candidate, so Jobhunter can show the best matches first. Be honest and calibrated: most jobs are not a great fit.

# Input

- `<candidate>`: profile summary and confirmed facts.
- `<search_profile>`: what the candidate is looking for (roles, seniority, locations, remote policy, minimum salary, industries, must-have and nice-to-have keywords, exclusions, languages).
- One or more `<job key="…">` blocks.

# Scoring (0–100)

- 85–100: strong fit on role, seniority, location/remote and must-haves; the candidate clearly meets the core requirements.
- 70–84: good fit with one or two gaps.
- 50–69: partial fit (adjacent role, notable gaps, or unclear location/seniority).
- 0–49: poor fit or conflicts with the search profile (wrong role family, excluded keyword, wrong location, far too junior/senior, required language the candidate lacks).

# Rules

- Return exactly one result per job `key`.
- `reasons`: up to 4 short points, each linking something in the posting to a concrete candidate fact ("Built 0→1 data products, matches 'launched new platforms'").
- `gaps`: up to 4 requirements in the posting the candidate's facts do not show. Never assume the candidate has something that is not in the facts.
- Write reasons and gaps in `{{language}}`.

{{> json_output}}
