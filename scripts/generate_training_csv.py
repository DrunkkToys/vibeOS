import json
import csv
import numpy as np
import os

RESULTS_PATH = os.path.expanduser("~/.claude/reports/experiment-v6-results-2026-05-23T16-14-27Z.json")
OUTPUT_PATH = "/Users/drunkktoys/Desktop/theSaver-oc/.experiment/routing-training.csv"

QUALITY_MODES = {"reporting", "defense_in_depth", "synthesis", "verify"}
FEATURES = ["combined", "ev", "hy", "un", "th", "tok"]
ROWS_PER_MODE = 60
SEED = 42

np.random.seed(SEED)

with open(RESULTS_PATH, "r") as f:
    data = json.load(f)

ranking = data["ranking"]

os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

with open(OUTPUT_PATH, "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(FEATURES + ["needs_quality"])

    for entry in ranking:
        mode = entry["mode"]
        means = {feat: float(entry[feat]) for feat in FEATURES}
        is_quality_mode = mode in QUALITY_MODES

        for _ in range(ROWS_PER_MODE):
            row = []
            for feat in FEATURES:
                mean = means[feat]
                sigma = 0.1 * abs(mean) if abs(mean) > 1e-9 else 0.01
                val = mean + np.random.normal(0, sigma)
                if val < 0 and feat != "combined":
                    val = 0.0
                row.append(round(val, 6))

            synthetic_combined = row[0]

            if is_quality_mode:
                needs_quality = 1
            else:
                if synthetic_combined > 1.95:
                    bias = np.random.random()
                    needs_quality = 1 if bias < 0.45 else 0
                else:
                    needs_quality = 0

            row.append(needs_quality)
            writer.writerow(row)

print(f"Training CSV written to {OUTPUT_PATH}")
print(f"Rows: {len(ranking) * ROWS_PER_MODE}")
