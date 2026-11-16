#!/usr/bin/env python3
"""Build the ATIP Popularity Index from the official request-count CSV."""
import argparse
from collections import defaultdict
import csv
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import gzip
import io
import json
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
from time import sleep
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CATALOG = "https://open.canada.ca/data/en/dataset/2916fad5-ebcc-4c86-b0f3-4f619b29f412/resource/e664cf3d-6cb7-4aaa-adfa-e459c2552e3e"
SOURCE = "https://open.canada.ca/data/dataset/2916fad5-ebcc-4c86-b0f3-4f619b29f412/resource/e664cf3d-6cb7-4aaa-adfa-e459c2552e3e/download/ati-informal-requests-analytics.csv"
FIELDS = {"year", "month", "unique identifier", "request number", "summary - en",
          "summary - fr", "owner_org", "organization name - en", "number of informal requests"}


def download():
    for attempt in range(3):
        try:
            with urlopen(Request(SOURCE, headers={"User-Agent": "CoolCode ATIP Popularity"}), timeout=90) as response:
                if response.headers.get_content_type() == "text/html":
                    raise ValueError("Expected CSV, received an HTML page.")
                value = response.headers.get("Last-Modified")
                try:
                    modified = parsedate_to_datetime(value).date().isoformat() if value else ""
                except (TypeError, ValueError, OverflowError):
                    modified = ""
                return response.read(), modified
        except (OSError, ValueError) as error:
            if attempt == 2:
                raise RuntimeError(f"Federal CSV download failed: {error}") from error
            sleep(2 ** attempt)


def read_records(raw):
    csv.field_size_limit(5_000_000)
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""))
    headings = {key.strip().casefold(): key for key in (reader.fieldnames or [])}
    if not FIELDS.issubset(headings):
        raise ValueError(f"The official CSV is missing fields: {', '.join(sorted(FIELDS - set(headings)))}.")
    orgs = {}
    periods = set()
    records = {}
    extras = 0
    conflicted = set()
    for row in reader:
        def field(name):
            return (row.get(headings[name]) or "").strip()

        if not any(row.values()):
            continue
        uid = field("unique identifier")
        if not uid:
            raise ValueError(f"Missing package UID on CSV line {reader.line_num}.")
        year = int(field("year"))
        month = int(field("month"))
        count = int(field("number of informal requests"))
        if not (1900 <= year <= 2200 and 1 <= month <= 12 and count >= 0):
            raise ValueError(f"Invalid month or count on CSV line {reader.line_num}.")
        period = f"{year:04d}-{month:02d}"
        periods.add(period)
        number, org = field("request number"), field("owner_org")
        name = field("organization name - en")
        if org not in orgs or (name and orgs[org] == org):
            orgs[org] = name or org or "Organization unavailable"
        descriptions = [field("summary - en"), field("summary - fr")]
        if uid not in records:
            records[uid] = [number, org, *descriptions, period, {}]
        record = records[uid]
        if (number and record[0] and record[0] != number) or (org and record[1] and record[1] != org):
            conflicted.add(uid)
        if not record[0]:
            record[0] = number
        if not record[1]:
            record[1] = org
        if period >= record[4]:
            record[2] = descriptions[0] or record[2]
            record[3] = descriptions[1] or record[3]
            record[4] = period
        elif not record[2] or not record[3]:
            record[2] = record[2] or descriptions[0]
            record[3] = record[3] or descriptions[1]
        prior = record[5].get(period)
        if prior is not None:
            # One count per published package and month. Never double-count a duplicate.
            extras += 1
            if prior != count:
                raise ValueError(f"Conflicting counts for UID {uid!r} in {period}.")
        record[5][period] = count
    if not records:
        raise ValueError("No records were parsed.")
    if conflicted:
        raise ValueError(f"{len(conflicted)} package identifiers have conflicting organizations or request numbers.")
    months = sorted(periods)
    order = {month: i for i, month in enumerate(months)}
    rows = [
        [uid, ref, org, en, fr, [value for month, n in sorted(series.items()) for value in (order[month], n)], sum(series.values())]
        for uid, (ref, org, en, fr, _, series) in records.items()
    ]
    rows.sort(key=lambda row: (-row[6], row[0]))
    return rows, orgs, months, extras


def write_build(raw, modified, output, live):
    rows, orgs, months, duplicates = read_records(raw)
    if live and len(rows) < 1000:
        raise ValueError("The published file appears incomplete (under 1,000 package identifiers).")
    with TemporaryDirectory(prefix="atip-popularity-", dir=output.parent) as tmp:
        stage = Path(tmp) / "site"
        shutil.copytree(ROOT / "web", stage)
        asset = stage / "data"
        asset.mkdir()
        chunks = []
        for i in range(0, len(rows), 12_000):
            records = rows[i:i+12_000]
            filename = f"packages-{i // 12_000 + 1:02}.json.gz"
            content = json.dumps(records, ensure_ascii=False, separators=(",", ":")).encode()
            (asset / filename).write_bytes(gzip.compress(content, compresslevel=6, mtime=0))
            chunks.append({"file": filename, "rows": len(records)})
        metadata = {"version": 1, "rows": len(rows), "organizations": orgs, "months": months,
                    "sourceUpdated": modified, "built": datetime.now(timezone.utc).isoformat(),
                    "chunks": chunks, "source": SOURCE, "catalog": CATALOG,
                    "count": sum(row[6] for row in rows), "duplicates": duplicates}
        (asset / "manifest.json").write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
        if output.exists():
            shutil.rmtree(output)
        stage.replace(output)
    print(f"{len(rows):,} packages · {len(months)} months · {metadata['count']:,} recorded informal requests")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, help="Use a local copy of the official CSV.")
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    output = args.output.resolve()
    if output in (ROOT, ROOT / "web", ROOT / ".git") or output in ROOT.parents:
        parser.error("Choose a dedicated output folder.")
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        raw, modified = (args.csv.read_bytes(), "") if args.csv else download()
        write_build(raw, modified, output, not args.csv)
    except (RuntimeError, ValueError, OSError, UnicodeError, csv.Error) as error:
        parser.exit(1, f"Build failed: {error}\n")


if __name__ == "__main__":
    main()
