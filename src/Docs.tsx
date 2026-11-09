import { Code, Link } from './ui.tsx'

const GENERIC = `Student,Q1,Q2,Q3,Q4
KEY,B,D,A,C
S001,B,D,A,A
S002,C,D,A,C
S003,B,A,B,C`

const BS_IMPORT = `OrgDefinedId,Username,Midterm 1 Points Grade,End-of-Line Indicator
#300101,#mchen12,34.5,#
#300102,#lokafor7,29,#`

export default function Docs() {
  return (
    <section className="page docs">
      <nav className="docs-nav" aria-label="Docs sections">
        <a href="#exports">Getting the export</a>
        <a href="#brightspace">Brightspace</a>
        <a href="#canvas">Canvas</a>
        <a href="#moodle">Moodle</a>
        <a href="#generic">Generic CSV</a>
        <a href="#stats">The statistics</a>
        <a href="#flags">Flags and thresholds</a>
        <a href="#regrade">Regrades and grade files</a>
        <a href="#bank">Item bank</a>
        <a href="#privacy">Privacy</a>
      </nav>
      <article>
        <div className="eyebrow">Docs</div>
        <h1>Exports, formats and the statistics</h1>
        <p className="dated">Written November 2026. LMS menus move between releases and depend on your role's permissions; if yours differ, the column lists below are what the importer actually looks for.</p>

        <section id="exports">
          <h2>Getting the export</h2>
          <p>You need one file per exam sitting with one of these shapes:</p>
          <ul>
            <li><b>Per-answer rows</b> (best): every student's chosen option for every question. Gives distractor analysis, miskey detection and accept-another-answer regrades.</li>
            <li><b>Per-question scores</b>: one row per student, one column per question. Gives difficulty, discrimination, reliability, drop and full-credit regrades.</li>
            <li><b>Per-question summary</b> (Canvas Item Analysis): no students. Feeds the item bank trend only.</li>
          </ul>
          <p>Export a CSV, not Excel. If your LMS only offers .xlsx, open it and save as CSV (UTF-8).</p>
        </section>

        <section id="brightspace">
          <h2>Brightspace (D2L)</h2>
          <h3>Quiz question details (recommended)</h3>
          <ol>
            <li>Open the course, then <b>Quizzes</b>.</li>
            <li>Open the quiz's menu and choose <b>Statistics</b>.</li>
            <li>Go to the <b>Question Details</b> tab and choose <b>Export to CSV</b>.</li>
          </ol>
          <p>The file has one row per student, attempt, question and answer option. The importer reads <code>Org Defined ID</code> or <code>Username</code>, <code>FirstName</code>/<code>LastName</code>, <code>Attempt #</code>, <code>Q #</code>, <code>Q Text</code> (or <code>Q Title</code>), <code>Answer</code>, <code>Answer Match</code> (the checked option), <code>Score</code> and <code>Out Of</code>. Only each student's first attempt is analysed. The answer key is inferred from which option earned full marks; check it in the Items tab.</p>
          <h3>Grades export</h3>
          <ol>
            <li><b>Grades</b> → <b>Enter Grades</b> → <b>Export</b>.</li>
            <li>Key field: <b>Org Defined ID</b> (and Username). Grade values: <b>Points grade</b>. Include the quiz's grade item.</li>
            <li>Export to CSV.</li>
          </ol>
          <p>Columns named <code>&lt;item&gt; Points Grade &lt;Numeric MaxPoints:N&gt;</code> become items with N points. <code>End-of-Line Indicator</code>, subtotals and final grades are ignored. This works for an exam whose questions are separate grade items, or to analyse assignments as items.</p>
          <p><b>Zeros versus blanks.</b> Brightspace distinguishes an ungraded item from a zero, and whether ungraded items count as zero depends on the Grades settings (<i>Settings → Calculation Options → Ungraded items: Drop / Treat as 0</i>). The importer counts blanks as zero and lists every blank in the validation report so you can check.</p>
        </section>

        <section id="canvas">
          <h2>Canvas</h2>
          <ol>
            <li>Classic Quizzes: open the quiz, then <b>Quiz Statistics</b>. New Quizzes: open the quiz, <b>Build</b>, then <b>Reports</b>.</li>
            <li>Generate <b>Student Analysis</b> and download the CSV. This has each student's answer text and score per question.</li>
            <li>Optionally generate <b>Item Analysis</b> for a per-question summary of past terms.</li>
          </ol>
          <p>Student Analysis columns read: <code>name</code>, <code>id</code>, <code>sis_id</code>, then for every question a <code>&lt;question id&gt;: &lt;question text&gt;</code> column followed by its score column whose header is the points possible. Answer texts are mapped to letters A, B, C in alphabetical order; the key is inferred from full-score answers.</p>
          <p>Item Analysis columns read: <code>Question Title</code>, <code>Correct Student Ratio</code> or <code>Difficulty Index</code>, <code>Point Biserial of Correct</code>, <code>Answered Student Count</code>.</p>
        </section>

        <section id="moodle">
          <h2>Moodle</h2>
          <ol>
            <li>Open the quiz, then <b>Results</b> → <b>Responses</b>.</li>
            <li>Under display options, show <b>Response</b> and <b>Right answer</b>, attempts from enrolled users, first attempt only if you allow several.</li>
            <li>Choose <b>Download table data as</b> CSV.</li>
          </ol>
          <p>Columns read: <code>Surname</code>, <code>First name</code>, <code>Email address</code> or <code>ID number</code>, <code>Response N</code>, <code>Right answer N</code>, and from the Grades report <code>Q. N /max</code>. If you download the Grades report instead, you get scores without option analysis. The “Overall average” row is skipped.</p>
        </section>

        <section id="generic">
          <h2>Generic CSV</h2>
          <p>One row per student. The first column (or a column called ID, Student, OrgDefinedId, Username or Email) identifies the student. Every other column is an item. Cells can be:</p>
          <ul>
            <li><b>Scores</b>: 0/1 or partial credit. Max points per item is the highest score seen, unless the header says <code>MaxPoints:N</code>.</li>
            <li><b>Letters</b>: the option chosen. Add a row whose first cell is <code>KEY</code>, or paste the key on the mapping step. <code>B/C</code> in the key accepts both.</li>
          </ul>
          <Code label="CSV" code={GENERIC} />
          <p>You can leave columns out on the mapping step. The validation report lists every non-numeric cell, score above the maximum, ragged row and duplicate student with its line number.</p>
        </section>

        <section id="stats">
          <h2>The statistics</h2>
          <ul>
            <li><b>Difficulty p</b>: mean score on the item divided by its points. For right/wrong items this is the share correct.</li>
            <li><b>Discrimination D</b>: p in the top 27% of students by total score minus p in the bottom 27% (Kelley's groups).</li>
            <li><b>Point-biserial r</b>: Pearson correlation between the item score and the total score.</li>
            <li><b>Corrected item-total r</b>: the same, with the item removed from the total. This is the y-axis of the item map and the number most flags use, because the uncorrected value is inflated on short tests.</li>
            <li><b>KR-20</b>: reliability for right/wrong items. Shown only when every item is 0/1.</li>
            <li><b>KR-21</b>: KR-20 assuming equal difficulty; a quick lower bound.</li>
            <li><b>Cronbach's alpha</b>: the general form, valid with partial credit. Identical to KR-20 for 0/1 items. <b>Alpha if deleted</b> recomputes it without each item.</li>
            <li><b>SEM</b>: SD × √(1 − reliability), in points. A student's “true” score is within about ±1 SEM of the observed one two times out of three; worth remembering at a grade boundary.</li>
            <li><b>Distractor curves</b>: share choosing each option in five score groups, lowest to top. A good key rises left to right; good distractors fall.</li>
          </ul>
          <p>All variances are population variances (divide by N), the convention for KR-20 and alpha. Blanks count as zero. Class summaries report the median and quartiles (spreadsheet interpolation), never ranks.</p>
        </section>

        <section id="flags">
          <h2>Flags and thresholds</h2>
          <ul>
            <li><b>Likely miskey</b>: a distractor whose choosers correlate positively with the rest of the test (r &gt; 0.10), more than the key does, and that the top 27% pick more often than the key.</li>
            <li><b>Ambiguous</b>: a distractor with positive r chosen by at least 20% of the top group and at least half as often as the key.</li>
            <li><b>Distractor attracts high scorers</b>: more top-group than bottom-group students chose it.</li>
            <li><b>Negative discrimination</b>: corrected r or D below zero.</li>
            <li><b>Weak discrimination</b>: D below 0.20.</li>
            <li><b>Too easy / too hard</b>: p above 0.90 or below 0.30.</li>
            <li><b>Non-functioning distractor</b>: chosen by fewer than 5% of students.</li>
          </ul>
          <p>Thresholds are editable in <Link href="/settings">Settings</Link>. With fewer than about 30 students, read discrimination and reliability as hints.</p>
        </section>

        <section id="regrade">
          <h2>Regrades and grade files</h2>
          <p>A regrade is one of: <b>drop</b> (removed from score and maximum), <b>full credit</b> (everyone gets the points), or <b>also accept</b> (students who chose the extra option get full marks). Decisions are saved with the sitting and appear in the report. Nothing changes in your LMS until you import the file.</p>
          <h3>Brightspace</h3>
          <p>The file has <code>OrgDefinedId</code> and <code>Username</code> (prefixed with <code>#</code>, as Brightspace exports them), one <code>&lt;grade item&gt; Points Grade</code> column and the required <code>End-of-Line Indicator</code> column with <code>#</code> on every row. The grade item name must match your gradebook exactly. Scores are on the scale you enter (“Points out of”).</p>
          <Code label="Brightspace Grades import" code={BS_IMPORT} />
          <ol>
            <li><b>Grades</b> → <b>Enter Grades</b> → <b>Import</b>.</li>
            <li>Choose the file, check the preview, and import. Brightspace overwrites the grade item's existing values for the students in the file.</li>
          </ol>
          <h3>Canvas</h3>
          <p>The file has <code>Student</code>, <code>ID</code>, <code>SIS User ID</code>, <code>SIS Login ID</code>, <code>Section</code> and one assignment column. Rename the assignment column to match your gradebook export exactly, including the id in parentheses, e.g. <code>Midterm 1 (4512)</code>. Import it from <b>Grades</b> → <b>Import</b>.</p>
        </section>

        <section id="bank">
          <h2>Item bank</h2>
          <p>Each import is a dated sitting. Items are matched across sittings by their question text (normalised: case, punctuation and HTML ignored), or by label when the export has no text (Moodle, generic CSV). The bank shows p and corrected r per term for every item, and a compare view between any two sittings that calls out items whose discrimination collapsed, a common sign the key was edited by mistake.</p>
        </section>

        <section id="privacy">
          <h2>Privacy</h2>
          <ul>
            <li>Files are parsed in your browser. There is no server step.</li>
            <li>On import, each student gets a pseudonym: a salted hash of their LMS id (or name if there is no id), unique per course. Tables show pseudonyms unless you turn names on.</li>
            <li>You can drop names at import, or by default in Settings. The LMS id is kept on this device only, because the grade import file needs it.</li>
            <li>Signing in is optional. Sync includes course names, item text, keys, regrade decisions and the per-item statistics. It never includes student names, LMS ids, pseudonyms or scores.</li>
            <li>Courses live in this browser's IndexedDB. Export or delete everything from the account menu or <Link href="/settings">Settings</Link>.</li>
          </ul>
        </section>
      </article>
    </section>
  )
}
