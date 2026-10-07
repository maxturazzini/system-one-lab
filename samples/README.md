# Public dataset snapshots

Run `npm run refresh-data` to download a small reproducible snapshot from the TED, openFDA and CPSC official APIs, including the Article 4 candidate search.

The generated file `public-snapshot.json` is intentionally ignored by Git:

- it can be refreshed at any time from the official sources;
- the records are refreshed by the agencies and can change over time;
- the running lab fetches live records and does not persist them.

Sources:

- TED Search API: https://docs.ted.europa.eu/api/latest/search.html
- openFDA Enforcement Reports: https://open.fda.gov/apis/food/enforcement/
- CPSC Recalls API: https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information
