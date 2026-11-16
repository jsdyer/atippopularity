const el = id => document.getElementById(id);
const ui = Object.fromEntries(["q","org","from","to","sort","status","results","pagination","previous","next","page","detail","detail-title","detail-body"].map(id => [id, el(id)]));
const nf = new Intl.NumberFormat("en-CA");
const df = new Intl.DateTimeFormat("en-CA", {year:"numeric", month:"short", timeZone:"UTC"});
const prettyMonth = value => df.format(new Date(value + "-01T00:00:00Z"));
const hash = new URLSearchParams(location.hash.slice(1));
let meta, worker, seq = 0, page = 1, timer, failed = false;
ui.q.value = hash.get("q") || "";

function node(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function link(text, url) {
  const item = node("a", text);
  item.href = url;
  item.target = "_blank";
  item.rel = "noopener noreferrer";
  return item;
}

function links(row) {
  const [id, reference, org] = row;
  const params = new URLSearchParams({q: reference ? `"${reference.replaceAll('"', "")}"` : id});
  if (org) params.set("institution",org);
  return [
    link("Official summary ↗", "https://open.canada.ca/en/search/ati/reference/" + encodeURIComponent(id)),
    link("Find in ATIP Explorer ↗", "https://coolcode.ca/atip/#" + params)
  ];
}

function summary(row) {
  return row[3] || row[4] || "No summary supplied.";
}

function detail(row) {
  const [id, reference, org, english, french, series, total] = row;
  ui["detail-title"].textContent = reference || id;
  const table = node("div", undefined, "timeline");
  for (let i = 0; i < series.length; i += 2) {
    const mark = node("div");
    mark.append(node("strong", nf.format(series[i+1])), document.createTextNode(prettyMonth(meta.months[series[i]])));
    table.append(mark);
  }
  const actions = node("p", undefined, "actions");
  actions.append(...links(row));
  const paragraphs = english ? [node("p", english, "record-text")] : [];
  if (french) {
    const frenchText = node("p", french, "record-text");
    frenchText.lang = "fr";
    const alternate = node("details");
    alternate.append(node("summary", "Résumé en français"), frenchText);
    paragraphs.push(alternate);
  }
  ui["detail-body"].replaceChildren(node("p", meta.organizations[org] || "Institution unavailable", "description"),
    ...paragraphs, actions, node("h3", "Recorded requests by month"),
    node("p", nf.format(total) + " in all published reporting months.", "limited"), table);
  if (!ui.detail.open) ui.detail.showModal();
}

function card([row,count,latest]) {
  const [id, reference, org] = row;
  const entry = node("li", undefined, "result");
  const top = node("div",undefined,"row-top");
  const view = node("button", reference || id,"uid");
  view.type = "button";
  view.addEventListener("click", () => detail(row));
  top.append(view, node("span", nf.format(count) + (count === 1 ? " request" : " requests"), "count"));
  const text = summary(row);
  const foot = node("p", undefined,"actions");
  foot.append(...links(row));
  entry.append(top, node("p", text.length > 460 ? text.slice(0, 460).trimEnd() + "…" : text, "summary"),
    node("p", `${meta.organizations[org] || "Institution unavailable"} · Latest in range: ${prettyMonth(meta.months[latest])}`, "description"), foot);
  return entry;
}

function search(reset = true) {
  if (!worker || failed || !meta) return;
  if (reset) page = 1;
  const query = ui.q.value.trim();
  const from = Number(ui.from.value), to = Number(ui.to.value);
  const filters = {query, organization:ui.org.value, from, to, sort:ui.sort.value};
  const params = new URLSearchParams();
  if (query) params.set("q",query);
  if (filters.organization) params.set("institution",filters.organization);
  if (from > 0) params.set("from",meta.months[from]);
  if (to < meta.months.length-1) params.set("to",meta.months[to]);
  if (filters.sort !== "popular") params.set("sort",filters.sort);
  history.replaceState(null,"",params.size ? "#" + params : location.pathname + location.search);
  worker.postMessage({id:++seq, filters, page});
}

function configured(manifest) {
  meta = manifest;
  el("metric-requests").textContent = nf.format(meta.count);
  el("metric-packages").textContent = nf.format(meta.rows);
  el("metric-period").textContent = nf.format(meta.months.length);
  for (const [code,name] of Object.entries(meta.organizations).sort((a,b) => a[1].localeCompare(b[1]))) {
    if (code) ui.org.add(new Option(name, code));
  }
  meta.months.forEach((month,index) => {
    ui.from.add(new Option(prettyMonth(month), index));
    ui.to.add(new Option(prettyMonth(month), index));
  });
  if (Object.hasOwn(meta.organizations, hash.get("institution"))) ui.org.value = hash.get("institution");
  ui.from.value = String(Math.max(0,meta.months.indexOf(hash.get("from"))));
  ui.to.value = String(meta.months.includes(hash.get("to")) ? meta.months.indexOf(hash.get("to")) : meta.months.length - 1);
  if (hash.get("sort") === "recent") ui.sort.value = "recent";
  const coverage = prettyMonth(meta.months[0]) + "–" + prettyMonth(meta.months.at(-1));
  const stamp = meta.built?.slice(0,10);
  el("source-dates").textContent = `Reporting coverage: ${coverage}. Snapshot built ${stamp || "date unavailable"}.` +
    (meta.sourceUpdated ? ` Source file last modified ${meta.sourceUpdated}.` : "");
  search();
}

function errorState() {
  failed = true;
  ui.status.textContent = "The published snapshot could not load. Reload the page or use the official source.";
  const retry = node("button","Reload");
  retry.addEventListener("click", () => location.reload());
  ui.results.replaceChildren(node("li"));
  ui.results.firstElementChild.append(retry);
}

ui.q.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(() => search(),90);
});
for (const key of ["org","from","to","sort"]) ui[key].addEventListener("change", () => search());
for (const chip of document.querySelectorAll("[data-query]")) chip.addEventListener("click", () => {
  ui.q.value = chip.dataset.query;
  search();
});
el("reset").addEventListener("click", () => {
  if (!meta) return;
  ui.q.value = ui.org.value = "";
  ui.from.value = "0";
  ui.to.value = String(meta.months.length-1);
  ui.sort.value = "popular";
  search();
});
ui.previous.addEventListener("click", () => { page--; search(false); });
ui.next.addEventListener("click", () => { page++; search(false); });
try {
  worker = new Worker(new URL("./worker.mjs", import.meta.url), {type:"module"});
  worker.addEventListener("error",errorState);
  worker.onmessage = ({data}) => {
    if (data.type === "metadata") configured(data.manifest);
    else if (data.type === "progress") ui.status.textContent = `Preparing search · ${nf.format(data.loaded)} packages loaded…`;
    else if (data.type === "error") errorState();
    else if (data.type === "results" && data.id === seq) {
      page = data.page;
      ui.results.replaceChildren(...data.rows.map(card));
      ui.status.textContent = Number(ui.from.value) > Number(ui.to.value) ? "Start month must come before end month." :
        data.total ? `${nf.format(data.total)} ${data.total === 1 ? "package" : "packages"} found` :
          "No packages match. Try a wider date range, shorter search, or fewer filters.";
      ui.pagination.hidden = data.pages <= 1;
      ui.page.textContent = `Page ${nf.format(page)} of ${nf.format(data.pages)}`;
      ui.previous.disabled = page <= 1;
      ui.next.disabled = page >= data.pages;
    }
  };
} catch { errorState(); }
