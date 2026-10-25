// WCAG contrast check for the colour pairs the stylesheet actually uses. Reads the :root variables from frontend/style.css,
// so changing the palette re-checks it.  Run: node tests/contrast.test.js
const fs = require('fs');
const css = fs.readFileSync(__dirname + '/../frontend/style.css', 'utf8');
const vars = {};
for (const m of css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) vars[m[1]] = m[2];
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const white = '#ffffff', gradEnd = '#52201f', cream = '#f6f1ee', zebra = '#fcf9f8', hover = '#f6eeeb', tint = '#e6d6d2', footerText = '#d9c7c3';
const pairs = [  // [description, foreground, background, minimum ratio]
  ['body text on page', vars.ink, vars.page, 4.5], ['body text on card', vars.ink, white, 4.5],
  ['muted text on card', vars.muted, white, 4.5], ['muted text on page', vars.muted, vars.page, 4.5],
  ['muted text on zebra row', vars.muted, zebra, 4.5], ['muted text on disabled card', vars.muted, cream, 4.5],
  ['muted text on soft badge', vars.muted, vars['brand-soft'], 4.5], ['table header text on soft tint', vars.brand, vars['brand-soft'], 4.5],
  ['table text on hovered row', vars.ink, hover, 4.5],
  ['white on primary button', white, vars.brand, 4.5], ['white on primary button hover', white, vars['brand-hover'], 4.5],
  ['brand text on card (headings, links)', vars.brand, white, 4.5], ['brand text on soft hover', vars.brand, vars['brand-soft'], 4.5],
  ['white on hero (gradient start)', white, vars.brand, 4.5], ['white on hero (gradient end)', white, gradEnd, 4.5],
  ['gold label on hero (gradient start)', vars.gold, vars.brand, 4.5], ['gold label on hero (gradient end)', vars.gold, gradEnd, 4.5],
  ['light text on hero (gradient end)', tint, gradEnd, 4.5], ['footer text on footer', footerText, vars.brand, 4.5],
  ['success message', vars.ok, vars['ok-bg'], 4.5], ['error message', vars.err, vars['err-bg'], 4.5],
  ['danger button text on card', vars.err, white, 4.5], ['danger button on hover', vars.err, vars['err-bg'], 4.5],
  ['focus ring on white (non-text, >=3)', vars.focus, white, 3], ['focus ring on page background (>=3)', vars.focus, vars.page, 3],
  ['focus ring on top bar / hero (>=3)', vars.focus, vars.brand, 3],
];
let bad = 0;
for (const [name, fg, bg, min] of pairs) {
  const r = ratio(fg, bg), ok = r >= min;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(2).padStart(5)}:1 (min ${min})  ${name}  ${fg} on ${bg}`);
}
console.log(`${pairs.length} pairs, ${bad} below WCAG AA`);
process.exit(bad ? 1 : 0);