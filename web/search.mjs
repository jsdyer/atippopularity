const wordBoundary = /[^\p{L}\p{N}]+/gu;

export function normalize(value) {
  return value.toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(wordBoundary, " ").trim();
}

export function prepare(rows, orgs) {
  return rows.map(row => [row, normalize([row[0], row[1], row[2], row[3], row[4], orgs[row[2]] || ""].join(" "))]);
}

export function find(packages, {query = "", organization = "", from = 0, to = Infinity, sort = "popular"}) {
  const words = Array.from(query.matchAll(/"([^"]*)"?|([^\s"]+)/gu),
    match => normalize(match[1] ?? match[2])).filter(Boolean);
  if (from > to) return [];
  const matches = [];
  for (const [row, index] of packages) {
    if (organization && row[2] !== organization || !words.every(word => index.includes(word))) continue;
    let count = 0;
    let latest = -1;
    let measured = false;
    const series = row[5];
    for (let i = 0; i < series.length; i += 2) {
      const period = series[i];
      if (period > to) break;
      if (period >= from) {
        measured = true;
        count += series[i + 1];
        latest = period;
      }
    }
    if (measured) matches.push([row, count, latest]);
  }
  matches.sort((a,b) => (sort === "recent" ? b[2]-a[2] || b[1]-a[1] : b[1]-a[1] || b[2]-a[2]) ||
    a[0][0].localeCompare(b[0][0]));
  return matches;
}
