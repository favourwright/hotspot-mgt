/**
 * The date formatters, including the shapes a date actually arrives in.
 *
 * The string case is why this exists. A server component passes a real
 * `Date`; the same row fetched through an API route has been through JSON
 * and arrives as an ISO string. The old coercion recognised only `Date` and
 * Firestore `Timestamp` and fell back to `new Date()` for everything else,
 * so every row of a refetched table rendered as the current moment -
 * identical dates down the whole column, with nothing to say they were
 * invented.
 *
 * Hence the other rule here: unparseable input renders as "-", never as a
 * plausible-looking wrong answer.
 *
 * Run: npm run test:format-date
 */
import { formatDate, formatDay } from "../lib/utils";

const ISO = "2026-10-16T09:30:00.000Z"; // 10:30 in Lagos
const EXPECT_DATE = "Oct 16, 2026, 10:30 AM";
const EXPECT_DAY = "16 Oct 2026";

const cases: Array<[string, unknown, string, string]> = [
  ["Date object", new Date(ISO), EXPECT_DATE, EXPECT_DAY],
  ["ISO string (through JSON)", ISO, EXPECT_DATE, EXPECT_DAY],
  ["epoch millis", Date.parse(ISO), EXPECT_DATE, EXPECT_DAY],
  [
    "Firestore Timestamp",
    { toDate: () => new Date(ISO) },
    EXPECT_DATE,
    EXPECT_DAY,
  ],
  ["null", null, "-", "-"],
  ["undefined", undefined, "-", "-"],
  ["empty string", "", "-", "-"],
  ["nonsense string", "not a date", "-", "-"],
  ["invalid Date", new Date("nope"), "-", "-"],
];

let failed = 0;
for (const [name, input, wantDate, wantDay] of cases) {
  // The formatters accept DateLike; these inputs deliberately include the
  // shapes callers get wrong, so the cast is the point of the test.
  const gotDate = formatDate(input as never);
  const gotDay = formatDay(input as never);
  const ok = gotDate === wantDate && gotDay === wantDay;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(26)} ${gotDate.padEnd(24)} ${gotDay}`
  );
  if (!ok) console.log(`      wanted: ${wantDate} | ${wantDay}`);
}

if (failed > 0) {
  console.error(`\n${failed} of ${cases.length} failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed.`);
