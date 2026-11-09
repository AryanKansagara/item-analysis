# Item Analysis

Find broken quiz questions before grades go out. A psychometrics workbench for college instructors and instructional designers who run quizzes in Brightspace, Canvas or Moodle.

**Live:** https://item-analysis.vercel.app

## The pain
LMS quiz statistics are hard to find, harder to read, and stop short of the fix. A miskeyed question quietly costs a class points; the regrade then has to land in the right gradebook column without breaking anything.

## Features
- Import Brightspace Question Details and Grades exports, Canvas Student Analysis and Item Analysis, Moodle responses, or any student × item CSV with an answer key. Format detection, column mapping and a validation report with line numbers.
- Difficulty, upper/lower 27% discrimination, point-biserial and corrected item-total r, KR-20, KR-21, Cronbach's alpha, alpha-if-deleted, SEM and score distribution.
- Distractor curves by score group; flags for likely miskeys, ambiguous items, negative discrimination, too easy/hard and non-functioning distractors, each with evidence and a suggested fix.
- Regrade simulator (drop, full credit, accept more answers) with per-student and grade-band impact.
- Brightspace and Canvas grade import CSVs, a student-facing class summary (median and quartiles, no ranks) and a printable exam quality report.
- Item bank across terms: per-item trends and a compare view between sittings.
- Local-first (IndexedDB). Optional email sign-in syncs courses and statistics; student names, ids and scores never leave the device.
- Synthetic samples: a 40-item, 180-student biology midterm with a miskey and a dead distractor (two terms), and a partial-credit stats quiz.

## Run locally
```
npm install
npm run dev
npm test
```
Optional sync: copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

Built by Aryan Kansagara. Independent project, not affiliated with D2L.
