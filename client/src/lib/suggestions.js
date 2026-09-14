/**
 * Build question starters from a dataset's column profile so the empty state
 * and composer suggest things that will actually work on this data.
 */
export function buildSuggestions(dataset, limit = 5) {
  const cols = dataset?.columns || [];
  const numeric = cols.filter((c) => c.data_type === 'number' && !/id$/i.test(c.name));
  const dates = cols.filter((c) => c.data_type === 'date');
  const cats = cols
    .filter((c) => c.data_type === 'text' && c.distinct_estimate > 1 && c.distinct_estimate <= 60)
    .sort((a, b) => a.distinct_estimate - b.distinct_estimate);

  const out = ['Give me an overview of this data'];
  const money = numeric.find((c) => c.currency) || numeric[0];
  const cat = cats[0];
  const cat2 = cats[1];
  const date = dates[0];

  if (money && cat) out.push(`Total ${money.name} by ${cat.name}`);
  if (money && cat) out.push(`Top 5 ${cat.name} by ${money.name}`);
  if (money && date) out.push(`How does ${money.name} trend by month?`);
  if (cat2) out.push(`Breakdown of ${cat2.name}`);
  else if (cat) out.push(`Breakdown of ${cat.name}`);
  if (money && !cat) out.push(`What is the average ${money.name}?`);
  if (!money && cat) out.push(`How many rows per ${cat.name}?`);

  return [...new Set(out)].slice(0, limit);
}

export const GENERIC_SUGGESTIONS = [
  'Give me an overview of this data',
  'What are the totals for the key numeric columns?',
  'Which category has the highest total?',
  'How do the numbers trend over time?',
];
