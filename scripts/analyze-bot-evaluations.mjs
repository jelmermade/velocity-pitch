import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dataDirectory = resolve(process.cwd(), 'data');
const names = (await readdir(dataDirectory))
  .filter((name) => /^bot-evaluation-.*\.json$/.test(name))
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
const reports = [];
for (const name of names) {
  try {
    reports.push(JSON.parse(await readFile(resolve(dataDirectory, name), 'utf8')));
  } catch {
    // A partially written or unrelated JSON artifact should not hide the usable history.
  }
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const average = (key) => {
  const values = reports.map((report) => report[key]).filter(finite);
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
};
const totalGoals = reports.map((report) => (
  (report.score?.azure ?? 0) + (report.score?.coral ?? 0)
));
const generations = reports
  .flatMap((report) => [report.knowledge?.previousGeneration, report.knowledge?.learnedGeneration])
  .filter(finite);
const round = (value) => Number(value.toFixed(3));

const summary = {
  reports: reports.length,
  generations: {
    first: generations.length === 0 ? null : Math.min(...generations),
    last: generations.length === 0 ? null : Math.max(...generations),
  },
  goalsPerMatch: round(totalGoals.reduce((total, value) => total + value, 0) / Math.max(1, reports.length)),
  touchesPerMatch: round(average('touches')),
  productiveTouchRate: round(average('productiveTouchRate')),
  alignedApproachConversionRate: round(average('alignedApproachConversionRate')),
  defenseHitRate: round(average('defenseHitRate')),
  aerialAttemptConversionRate: round(average('aerialAttemptConversionRate')),
  productiveAerialAttemptRate: round(average('productiveAerialAttemptRate')),
  jumpContactConversionRate: round(average('jumpContactConversionRate')),
  v3: {
    reports: reports.filter(({ schemaVersion }) => schemaVersion === 3).length,
    hardTouchRate: round(average('hardTouchRate')),
    productiveHardTouchRate: round(average('productiveHardTouchRate')),
    meanTouchImpulseSpeed: round(average('meanTouchImpulseSpeed')),
    meanPostTouchBallSpeed: round(average('meanPostTouchBallSpeed')),
    shotOnTargetRate: round(average('shotOnTargetRate')),
    aerialShotOnTargetRate: round(average('aerialShotOnTargetRate')),
    meanShotAlignment: round(average('meanShotAlignment')),
  },
};

console.log(JSON.stringify(summary, null, 2));
