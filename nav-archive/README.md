# NAV archive

Daily disaster-recovery snapshots of AMFI's `NAVAll.txt`, one per trading day,
named `DD-MM-YYYY.txt.gz`. Committed automatically by
[`.github/workflows/archive-nav.yml`](../.github/workflows/archive-nav.yml)
Mon–Sat at 11:30 PM IST.

Each file is the AMFI feed with dead schemes removed (last NAV before 2024) and
then gzipped — about 0.2 MB vs ~1.6 MB raw.

## Reading them again

Decompress **all** snapshots at once (works in Git Bash on Windows too):

```bash
gunzip nav-archive/*.gz          # replaces .gz with .txt
# or keep the .gz originals:
gzip -dk nav-archive/*.gz
```

Peek at a single day without unpacking the rest:

```bash
zcat nav-archive/20-06-2026.txt.gz | less     # or: gunzip -c <file> | head
```

## File format

Semicolon-delimited, same as AMFI's `NAVAll.txt`:

```
Scheme Code;ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
119551;INF209KA12Z1;INF209KA13Z9;<name>;105.9219;19-Jun-2026
```

To rebuild the DB, decompress the file(s) and feed the data lines through the
same parse + upsert logic used by `POST /sync-nav` (`api/routes/sync.js`).
