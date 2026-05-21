#!/usr/bin/env python3
"""Merge multiple CSV files on a common key, handle mismatched schemas, log all errors."""

import csv
import sys
import os
import logging
from collections import OrderedDict

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("csv_merge")


def load_csv(path, key_column):
    rows = []
    fieldnames = None
    try:
        with open(path, "r", newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames:
                log.warning("Empty CSV or no headers: %s", path)
                return rows, set()
            fieldnames = list(reader.fieldnames)
            if key_column not in fieldnames:
                log.error("Key column '%s' not found in %s. Columns: %s", key_column, path, fieldnames)
                return rows, set()
            for i, row in enumerate(reader):
                if not any(v and v.strip() for v in row.values()):
                    log.debug("Skipping empty row %d in %s", i + 2, path)
                    continue
                rows.append(row)
    except Exception as e:
        log.error("Failed to read %s: %s", path, e)
        return rows, set()
    log.info("Loaded %d rows from %s (columns: %d)", len(rows), path, len(fieldnames))
    return rows, set(fieldnames)


def merge_csvs(file_paths, key_column, output_path):
    master = OrderedDict()
    all_columns = set()
    total_errors = 0

    for fpath in file_paths:
        if not os.path.exists(fpath):
            log.error("File not found: %s", fpath)
            total_errors += 1
            continue

        rows, cols = load_csv(fpath, key_column)
        if not cols:
            continue
        all_columns.update(cols)

        for row in rows:
            key = row.get(key_column)
            if key is None:
                key = ""
            key = key.strip()
            if not key:
                log.warning("Row with empty/missing key in %s", fpath)
                total_errors += 1
                continue

            if key in master:
                existing = master[key]
                for col, val in row.items():
                    if col == key_column:
                        continue
                    if val is None or (isinstance(val, str) and not val.strip()):
                        continue
                    existing_val = existing.get(col)
                    if existing_val is None or (isinstance(existing_val, str) and not existing_val.strip()):
                        existing[col] = val
                    elif val != existing_val:
                        log.debug("Conflict on %s='%s': '%s' vs '%s'", col, key, existing_val, val)
                        total_errors += 1
            else:
                master[key] = row

    log.info("Merged into %d unique keys across %d columns", len(master), len(all_columns))
    log.info("Total errors/warnings: %d", total_errors)

    fieldnames = [key_column] + sorted(c for c in all_columns if c != key_column)
    try:
        with open(output_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            for row in master.values():
                writer.writerow(row)
        log.info("Written to %s", output_path)
    except Exception as e:
        log.error("Failed to write %s: %s", output_path, e)
        sys.exit(1)

    return master


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python merge_csv.py <key_column> <output.csv> <input1.csv> [input2.csv ...]")
        print("Example: python merge_csv.py id merged.csv data/*.csv")
        sys.exit(1)

    key_column = sys.argv[1]
    output_path = sys.argv[2]
    input_files = sys.argv[3:]

    merge_csvs(input_files, key_column, output_path)
