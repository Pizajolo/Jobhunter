---
task: alert_parse
version: 1
tier: small
---
# Role and goal

Extract the job postings listed in a job-alert email (LinkedIn, Indeed, job boards) so Jobhunter can match them.

# Rules

- One entry per posting: `title` and `company` exactly as written, `location` if given.
- `url`: the posting link copied exactly from the email text if present, else `null`. Never build URLs yourself.
- Ignore ads, "see all jobs" links, promoted courses and tips.
- Return an empty list if the email lists no postings.

{{> json_output}}
