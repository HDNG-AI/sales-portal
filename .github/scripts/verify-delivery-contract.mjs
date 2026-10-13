import { appendFileSync } from 'node:fs';

const body = process.env.PR_BODY ?? '';
const base = process.env.PR_BASE ?? '';
const required = ['Delivery target', 'Odelco impact', 'Backport plan', 'Database migration', 'External integration', 'Verification owner'];

function field(name) {
  const escaped = name.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
  const line = body.match(new RegExp('^' + escaped + ':\\s*(.+?)\\s*$', 'im'));
  return line?.[1]?.trim() ?? '';
}

const values = Object.fromEntries(required.map((name) => [name, field(name)]));
const problems = [];
for (const name of required) {
  if (!values[name] || /^TODO\b/i.test(values[name])) problems.push('Missing: ' + name);
}
if (values['Delivery target'] && values['Delivery target'] !== base) {
  problems.push('Delivery target must equal PR base: ' + base);
}
for (const name of ['Odelco impact', 'Database migration', 'External integration']) {
  if (values[name] && !/^(yes|no)$/i.test(values[name])) problems.push(name + ' must be yes/no');
}
const impact = values['Odelco impact']?.toLowerCase();
const backport = values['Backport plan'] ?? '';
if (base === 'main' && impact === 'yes' &&
    !(/https:\/\/github\.com\/[^\s]+\/issues\/\d+/.test(backport) ||
      /https:\/\/github\.com\/[^\s]+\/pull\/\d+/.test(backport) ||
      /^not-needed:\s*\S.{9,}$/.test(backport))) {
  problems.push('Main + Odelco impact=yes requires a staging issue/PR link or a specific not-needed: reason');
}
if (base === 'odelco-staging' && values['Backport plan'] &&
    values['Backport plan'] !== 'direct-to-staging') {
  problems.push('A staging PR must declare Backport plan: direct-to-staging');
}
const report = [
  '## Delivery contract (advisory rollout)',
  'Base branch: `' + base + '`',
  ...required.map((key) => '- ' + key + ': ' + (values[key] || '(missing)')),
  '',
  problems.length ? '**Action required:**\n' + problems.map((p) => '- ' + p).join('\n') : 'All metadata checks passed.',
  '',
  'This job reviews declarations, not deployment, business acceptance or API permissions.',
].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
console.log(report);
for (const problem of problems) console.log('::warning::' + problem);
if (problems.length && process.env.DELIVERY_METADATA_ENFORCE === 'true') process.exitCode = 1;
