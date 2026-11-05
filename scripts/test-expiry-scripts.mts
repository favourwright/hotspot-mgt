/**
 * The router expiry sweeper and the legacy-checker recogniser.
 *
 * The recogniser is what decides whether something on a tenant's router is
 * deleted, so most cases here are about what it must refuse.
 *
 * Run: npm run test:expiry-scripts
 */
import {
  isCurrentProfileExpiryScript,
  isOurLegacyExpiryScheduler,
  isOurLegacyExpiryScript,
  profileExpiryScriptName,
  profileExpirySchedulerName,
  profileExpiryScriptSource,
} from "../lib/router-expiry-scripts";

let failed = 0;
let total = 0;

function check(name: string, got: unknown, want: unknown) {
  total += 1;
  const ok = String(got) === String(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(66)} ${got}`);
  if (!ok) console.log(`      wanted: ${want}`);
}

// The version that was live until dbe9917, as RouterOS might hand it back:
// CRLF line endings and different indentation.
const legacyClamp = `:foreach u in=[/ip hotspot user find] do={
  :local comment [/ip hotspot user get $u comment]
  :local ucode [:pick $comment 0 2]
  :if ([:len $comment] > 10 and $ucode != "vc") do={
    :local expStr $comment
    :local expTime [:totime $expStr]
    :local nowDate [/system clock get date]
    :local nowTime [/system clock get time]
    :local nowStr ("$nowDate $nowTime")
    :local nowTime [:totime $nowStr]
    :if ($nowTime > $expTime) do={
      /ip hotspot user set limit-uptime=1s $u
    }
  }
}`;

console.log("\n-- legacy recogniser");
check("exact legacy clamp body is ours", isOurLegacyExpiryScript(legacyClamp), true);
check(
  "CRLF and re-indented legacy body is ours",
  isOurLegacyExpiryScript(legacyClamp.replace(/\n/g, "\r\n").replace(/^ {2}/gm, "\t")),
  true
);
check(
  "legacy disable variant (75b3c6d) is ours",
  isOurLegacyExpiryScript(legacyClamp.replace("set limit-uptime=1s $u", "disable $u")),
  true
);
check(
  "tenant-edited body is NOT ours",
  isOurLegacyExpiryScript(legacyClamp.replace("1s", "5s")),
  false
);
check(
  "tenant appended a line: NOT ours",
  isOurLegacyExpiryScript(legacyClamp + '\n:log info "done"'),
  false
);
check("empty body is NOT ours", isOurLegacyExpiryScript(""), false);
check("missing body is NOT ours", isOurLegacyExpiryScript(undefined), false);
check("scheduler running our script", isOurLegacyExpiryScheduler("check-voucher-expiry"), true);
check("scheduler running something else", isOurLegacyExpiryScheduler("my-script"), false);
check("scheduler with no on-event", isOurLegacyExpiryScheduler(undefined), false);

console.log("\n-- current sweeper");
const src = profileExpiryScriptSource("Daily 1GB");
check("scoped to the profile", src.includes('find profile="Daily 1GB"'), true);
check("skips users already clamped (00:00:01)", src.includes('$lu != "00:00:01"'), true);
check("skips users already clamped (1s)", src.includes('$lu != "1s"'), true);
check("clock read once, before the loop", src.indexOf("/system clock get date") < src.indexOf(":foreach"), true);
check("exactly one write", src.split("/ip hotspot user set").length - 1, 1);
check("never disables a user", src.includes("disable"), false);
check("leaves unactivated vc users alone", src.includes('$ucode != "vc"'), true);
check(
  "a quote in a profile name cannot break out",
  profileExpiryScriptSource('a"b').includes('profile="a\\"b"'),
  true
);
check("current body recognised as current", isCurrentProfileExpiryScript("Daily 1GB", src), true);
check(
  "previous body recognised as outdated",
  isCurrentProfileExpiryScript(
    "Daily 1GB",
    legacyClamp.replace("[/ip hotspot user find]", '[/ip hotspot user find profile="Daily 1GB"]')
  ),
  false
);
check("script name", profileExpiryScriptName("Daily 1GB"), "vc-check-daily-1gb");
check("scheduler name", profileExpirySchedulerName("Daily 1GB"), "vc-sched-daily-1gb");

console.log(`\n${total - failed}/${total} passed`);
if (failed > 0) process.exit(1);
