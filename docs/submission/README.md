# Contest Submission

This directory is the human-readable entry point for the SmartFarmOS contest
submission rehearsal. It does not turn an incomplete gate into a pass.

## Official deliverables

The 2026-08-06 official submission guide sets the deadline at
`2026-08-27 18:00 KST`. Upload one ZIP containing the editable report
(`HWP/HWPX` or `DOC/DOCX`), the matching PDF, and the duplicate-benefit form
only when applicable. The report must include the mandatory SBOM, one public
repository URL, and a YouTube URL for a demo no longer than three minutes.
See [official-requirements.md](./official-requirements.md) for the exact flow,
source-publication terms, AI ambiguity, and the remaining owner-only facts.
Use [cloud-productization-plan.md](./cloud-productization-plan.md) to keep the
approved one-month cloud resource subordinate to the mandatory submission
gates and to separate contest staging from post-contest production work.

## Rehearsal order

1. Complete 3–5 real anonymous usability sessions using
   `docs/usability/facilitator-quickstart.md`, record each bounded result with
   `npm run usability:record -- S01`, and generate the aggregate.
2. Finish credential rotation and prior-work/provenance review without writing
   secret values into this repository.
3. Run `npm run submission:license-audit` to verify every external dependency
   declares a license. The owner selected Apache-2.0 for project-owned
   SmartFarmOS source on 2026-08-24; dependencies and third-party materials
   retain their own licenses, and the command does not decide compatibility.
4. Fill the official report template, including the mandatory SBOM. Keep the
   coding-assistance AI appendix until the contest office answers whether it
   should be included when no AI model is embedded in the product.
5. Optionally create a fresh, silent PWA candidate with
   `npm run submission:video-draft`. It uses a temporary database and headless
   browser, verifies the required UI evidence, and writes only an unreviewed
   MP4 under `artifacts/submission/`; it does not inspect privacy, narration, or
   claim accuracy. Edit or narrate it as needed, then personally review the
   final video of at most 180 seconds. Keep the final encoding under
   `artifacts/submission/`, then run
   `npm run submission:video-proof -- artifacts/submission/smartfarm-demo.mp4 --reviewed`.
   The explicit flag is a human privacy/claims/narration assertion; the command
   uses `ffprobe`, measures the real file, hashes it, and creates the local
   `video-proof.json` without overwriting existing evidence.
6. Create an identifiable Git commit, push that exact commit to the public
   representative repository, verify it from a fresh clone, and run the
   rehearsal from that clone. The current rehearsal command checks the local
   worktree and origin string only; it does not prove the commit is remotely
   fetchable or reproducible.

7. Build one ZIP from the final editable report, matching PDF, and the
   duplicate-benefit form only if applicable. Upload it, choose
   `출품작 제출 완료하기`, then verify both the `제출 완료` screen state and the
   completion email.

The local rehearsal command is:

```bash
npm run submission:rehearse
```

The command runs the full repository verification and writes a status-only
report under `artifacts/submission/rehearsal/`. Rehearsal and usability outputs
are restricted to their ignored `artifacts/` roots, and existing evidence is
preserved unless `--force` is explicitly supplied. Use `--force` only after
copying the prior evidence. `WARN` or `BLOCK` is not an authorization to
publish.

## Current machine evidence

The latest local rehearsal ran on 2026-08-10 and remained **BLOCK** with
`9 pass / 1 warn / 9 block` in
`artifacts/submission/rehearsal/report.{md,json}`.

- `SMARTFARM_REQUIRE_BROWSER=1 npm run verify` passed again on 2026-08-24 with 304 workspace tests,
  90 submission/tool tests (394 total), and the browser smoke.
- `npm run submission:license-audit` passed for 155 external package entries.
- The 2026-08-24 public-tip fresh clone contains 273 tracked files; the privacy
  preflight scanned 270 text files, while its three skipped PNG icons contain
  no text or EXIF metadata chunks. A high-confidence source/history check found
  no real API-key or private-key signature. The generic scanner still reports
  12 reviewed `credential_assignment` code/test false positives, more than 1,100 broad
  heuristic warnings, and missing `opf`, so its raw decision remains **BLOCK**
  rather than a formal privacy PASS.
- An unreviewed candidate video exists at
  `artifacts/submission/smartfarm-demo-candidate.mp4`.
- The official 2026 report template and an explicitly non-uploadable draft are
  kept under ignored `artifacts/submission/` paths. Placeholders and a
  `DRAFT_NOT_FOR_UPLOAD` filename must be removed only after owner review.

Use [non-human-readiness.md](./non-human-readiness.md) for the concise
machine-verifiable subset only.

## Documents

- [release-checklist.md](./release-checklist.md): owner and technical gates
- [non-human-readiness.md](./non-human-readiness.md): machine-verifiable subset
- [result-report.md](./result-report.md): report draft
- [demo-rehearsal.md](./demo-rehearsal.md): three-minute capture script
- [presentation-outline.md](./presentation-outline.md): later presentation deck outline
- [ai-use-disclosure.md](./ai-use-disclosure.md): honest AI-assistance draft
