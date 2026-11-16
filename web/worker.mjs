import {prepare, find} from "./search.mjs";

let entries, pending, previousKey, previousRows;

async function request(path) {
  const response = await fetch(new URL(path, import.meta.url), {signal: AbortSignal.timeout(75_000)});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

async function load() {
  const manifest = await (await request("./data/manifest.json")).json();
  if (manifest.version !== 1 || !manifest.rows || !manifest.chunks.length) throw new Error("Incomplete manifest");
  self.postMessage({type:"metadata", manifest});
  let loaded = 0, next = 0;
  const buffers = [];
  async function read() {
    while (next < manifest.chunks.length) {
      const index = next++;
      const chunk = manifest.chunks[index];
      const bytes = new Uint8Array(await (await request(`./data/${chunk.file}`)).arrayBuffer());
      const blob = new Blob([bytes]);
      const json = bytes[0] === 31 && bytes[1] === 139
        ? await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).json()
        : JSON.parse(await blob.text());
      if (json.length !== chunk.rows) throw new Error("Snapshot package count did not match");
      buffers[index] = json;
      loaded += json.length;
      self.postMessage({type:"progress", loaded});
    }
  }
  await Promise.all(Array.from({length:Math.min(4, manifest.chunks.length)}, read));
  if (loaded !== manifest.rows) throw new Error("Snapshot is incomplete");
  entries = prepare(buffers.flat(), manifest.organizations);
  if (pending) search(pending);
}

function search({id, filters, page}) {
  const key = JSON.stringify(filters);
  if (previousKey !== key) {
    previousRows = find(entries, filters);
    previousKey = key;
  }
  const limit = 15;
  const pages = Math.max(1, Math.ceil(previousRows.length / limit));
  page = Math.min(pages, Math.max(1,page));
  self.postMessage({type:"results", id, total:previousRows.length, page, pages,
    rows:previousRows.slice((page-1)*limit,page*limit)});
}

self.onmessage = ({data}) => {
  if (entries) search(data);
  else pending = data;
};
load().catch(error => self.postMessage({type:"error", message:error.message}));
