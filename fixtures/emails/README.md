Synthetic email eval set (spec §5.5): 55 emails in EN/DE/FR/ES/PT/IT covering every class, with
tricky cases (a rejection that mentions "interview", an ATS newsletter, an interview invite at a company
with two open applications, recruiter outreach). Everything is fictional. `cases.json` holds the
applications used for matching, the expected class and application per email, and recorded model
answers for replay. Regenerate with `python3 fixtures/emails/generate.py`.

`pnpm eval:email` replays the recorded answers (tests the prefilter, matching and status rules).
`pnpm eval:email --live` classifies with the real model and reports accuracy; `--record` saves those answers.
