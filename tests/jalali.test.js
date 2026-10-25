// Run: node tests/jalali.test.js /path/to/expected.json   (expected = [gy,gm,gd,jy,jm,jd] rows from jdatetime)
const J = require('../frontend/jalali.js');
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let bad = 0;
for (const [gy, gm, gd, jy, jm, jd] of rows) {
  const j = J.toJalali(gy, gm, gd), g = J.toGregorian(jy, jm, jd);
  if (j.jy !== jy || j.jm !== jm || j.jd !== jd || g.gy !== gy || g.gm !== gm || g.gd !== gd) {
    if (bad++ < 5) console.log('MISMATCH', [gy, gm, gd], [jy, jm, jd], j, g);
  }
}
console.log(`jdatetime: ${rows.length} days checked, ${bad} mismatches`);

// second, independent source: ICU's Persian calendar built into Node.
// ICU drifts by a day from Solar 1502 on (long-range leap rule), so compare only 1200..1500.
const fmt = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
let bad2 = 0, icuDays = 0;
for (const [gy, gm, gd, jy, jm, jd] of rows) {
  if (jy > 1500) continue;
  icuDays++;
  const p = Object.fromEntries(fmt.formatToParts(new Date(Date.UTC(gy, gm - 1, gd))).map(x => [x.type, x.value]));
  if (+p.year !== jy || +p.month !== jm || +p.day !== jd) { if (bad2++ < 5) console.log('ICU DIFF', [gy, gm, gd], [jy, jm, jd], p); }
}
console.log(`ICU (years <= 1500): ${icuDays} days checked, ${bad2} differences`);

// month lengths and ranges
let badLen = 0;
for (let y = 1200; y <= 1632; y++) for (let m = 1; m <= 12; m++) {
  const r = J.monthRange(y, m);
  const days = (Date.parse(r.to) - Date.parse(r.from)) / 864e5 + 1;
  if (days !== J.monthLength(y, m)) badLen++;
  const nxt = m === 12 ? J.toGregorian(y + 1, 1, 1) : J.toGregorian(y, m + 1, 1);
  if (Date.parse(J.iso(nxt)) - Date.parse(r.to) !== 864e5) badLen++;   // next month starts the day after
}
console.log(`month ranges: ${badLen} problems`);
console.log('digits:', J.fa('1405/07/30'), J.en('۱۲۳٤٥٦'), 'known: 2026-10-22 ->', J.toJalali(2026, 10, 22), ' 1403 leap:', J.isLeap(1403), ' 1404 leap:', J.isLeap(1404));
process.exit(bad || bad2 || badLen ? 1 : 0);