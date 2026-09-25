# CounselNote

A local-first record system for counsellors working in UK schools. Pupil profiles, session records, outcome totals and school settings are encrypted in the browser with AES-GCM and are not sent to a remote server.

The working name shown in the app can still be customised per school in **Settings & safety** if a school wishes to relabel it internally.

## Start

**Windows**

1. Double-click `start.ps1`, or run:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

**macOS / Linux**

1. Open Terminal in this folder and run:

```bash
./start.sh
```

2. Open `http://127.0.0.1:8790` if it doesn't open automatically.
3. Create a vault passphrase of at least 10 characters.

Node.js (v18+) is required on the computer. Keep the terminal window open while using the app.

## Included

- Encrypted pupil profiles and chronological counselling records
- Referral source and parent/carer involvement notes
- Consent, contracting and confidentiality prompts
- Pupil voice, wishes and feelings
- Objective session record, intervention, response and educational impact
- Safeguarding concern, decision, rationale, action and outcome
- School child-protection system reference and DSL minimum-necessary summary
- Action ownership, deadlines and follow-up queue
- GAD-7, PHQ-9/PHQ-A, SDQ and WEMWBS total-score records
- De-identified service reporting and CSV export
- Local DSL, children’s social care/MASH and CAMHS contacts
- Encrypted backup and restoration in a fresh browser profile
- Ten-minute inactivity lock

## UK practice position

There is no single statutory national counselling-note template for every UK school. The app therefore combines:

- the safeguarding-record expectations in **Keeping Children Safe in Education 2025** for England;
- the child-centred and multi-agency principles in **Working Together to Safeguard Children 2026**;
- UK data-protection principles, including purpose limitation, data minimisation, accuracy, storage limitation, security and accountability; and
- professional counselling record-keeping practice.

Schools outside England must configure the product against the applicable national guidance and local procedures.

## Important

- A forgotten passphrase cannot be recovered.
- Download encrypted backups regularly and keep them in approved secure storage.
- Restore a backup before creating another vault, then enter the original passphrase.
- Safeguarding concerns must also be recorded in the school’s approved child-protection system.
- This app does not replace professional judgement, school safeguarding procedures, clinical supervision, a DPIA, retention policy or an approved child-protection platform.
- Confirm assessment-tool licensing and current authorised scoring guidance before use.
- Avoid shared computers and shared operating-system accounts.

See `PRICING.md` for the proposed UK commercial structure and `LICENCE.txt` for the draft end-user licence (have this reviewed by a solicitor before taking payment).
