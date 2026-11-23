# ATIP Popularity Index

<!-- coolcode:guide -->
Choose a reporting period and search a topic, reference or institution to find packages whose copies were requested. Counts describe that informal-request channel and period, not unique readers or the date the original records were released.
<!-- /coolcode:guide -->

A browser-only search and ranking tool for the Treasury Board of Canada Secretariat's [ATI informal requests per summary](https://open.canada.ca/data/en/dataset/2916fad5-ebcc-4c86-b0f3-4f619b29f412/resource/e664cf3d-6cb7-4aaa-adfa-e459c2552e3e) dataset. Published at <https://coolcode.ca/atippopularity/> when GitHub Pages deployment succeeds.

Search titles, request references and institutions, select a period, see package counts and follow links to the government summary or the CoolCode ATIP Explorer. The reporting periods are the months when copies of completed records were requested. They are distinct from the dates those records were first released. The counts do not identify distinct requesters and only represent the informal-request channel covered by the published resource. Untabulated periods and packages are unavailable.

## Build

```sh
python3 scripts/build.py
python3 -m http.server -d dist 8080
```

Use `python3 scripts/build.py --csv /path/to/ati-informal-requests-analytics.csv` to build from a saved official file. The importer groups one count per package identifier and month, removes exact count duplicates, validates results and creates compressed shards in `dist/data/`. The browser loads the published snapshot and searches in a Web Worker. No data entries are created if the upstream CSV cannot be fetched or validated.

GitHub Actions refreshes the source daily or on manual dispatch and publishes `dist/` to Pages. A failed build keeps the last successful published snapshot.

Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).
