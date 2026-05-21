import argparse
import csv
import os

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.preprocessing import StandardScaler


class MLPipeline:
    def __init__(self, n_estimators=100, max_depth=None, random_state=42):
        self.n_estimators = n_estimators
        self.max_depth = max_depth
        self.random_state = random_state
        self.model = None
        self.scaler = None
        self.feature_names = None
        self.cv_results = None

    def read_csv(self, filepath):
        if not os.path.isfile(filepath):
            raise FileNotFoundError(f"File not found: {filepath}")
        with open(filepath, "r") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
        if not rows:
            raise ValueError("CSV file is empty")
        return rows, reader.fieldnames

    def clean_data(self, rows, fieldnames, target_col, drop_cols=None, fill_strategy="mean"):
        drop_cols = drop_cols or []
        if target_col not in fieldnames:
            raise ValueError(f"Target column '{target_col}' not in CSV columns: {fieldnames}")

        feature_names = [c for c in fieldnames if c != target_col and c not in drop_cols]
        X_raw, y_raw = [], []

        for row in rows:
            try:
                y_val = float(row[target_col])
            except (ValueError, TypeError):
                continue
            feat = []
            skip = False
            for c in feature_names:
                val = row.get(c, "")
                try:
                    feat.append(float(val))
                except (ValueError, TypeError):
                    skip = True
                    break
            if not skip:
                X_raw.append(feat)
                y_raw.append(y_val)

        X = np.array(X_raw, dtype=float)
        y = np.array(y_raw, dtype=float)

        if X.size == 0:
            raise ValueError("No valid numeric data after cleaning")

        if fill_strategy == "mean":
            col_means = np.nanmean(X, axis=0)
            for i in range(X.shape[1]):
                mask = np.isnan(X[:, i])
                X[mask, i] = col_means[i]
        elif fill_strategy == "median":
            col_medians = np.nanmedian(X, axis=0)
            for i in range(X.shape[1]):
                mask = np.isnan(X[:, i])
                X[mask, i] = col_medians[i]
        elif fill_strategy == "zero":
            X = np.nan_to_num(X)

        self.feature_names = feature_names
        return X, y

    def split_data(self, X, y, test_size=0.2):
        return train_test_split(X, y, test_size=test_size, random_state=self.random_state)

    def scale_features(self, X_train, X_test):
        self.scaler = StandardScaler()
        X_train_scaled = self.scaler.fit_transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)
        return X_train_scaled, X_test_scaled

    def train(self, X_train, y_train):
        self.model = RandomForestClassifier(
            n_estimators=self.n_estimators,
            max_depth=self.max_depth,
            random_state=self.random_state,
            n_jobs=-1,
        )
        self.model.fit(X_train, y_train)
        return self.model

    def evaluate(self, X, y, cv=5):
        scores = cross_val_score(self.model, X, y, cv=cv, scoring="accuracy")
        self.cv_results = {
            "mean_accuracy": float(scores.mean()),
            "std_accuracy": float(scores.std()),
            "per_fold": [float(s) for s in scores],
        }
        return self.cv_results

    def save(self, filepath):
        payload = {"model": self.model}
        if self.scaler is not None:
            payload["scaler"] = self.scaler
        if self.feature_names is not None:
            payload["feature_names"] = self.feature_names
        joblib.dump(payload, filepath)

    def run(self, input_path, target_col, output_path, drop_cols=None,
            fill_strategy="mean", test_size=0.2, cv=5):
        rows, fieldnames = self.read_csv(input_path)
        X, y = self.clean_data(rows, fieldnames, target_col, drop_cols, fill_strategy)
        X_train, X_test, y_train, y_test = self.split_data(X, y, test_size)
        X_train_scaled, X_test_scaled = self.scale_features(X_train, X_test)
        self.train(X_train_scaled, y_train)
        results = self.evaluate(X_test_scaled, y_test, cv=cv)
        self.save(output_path)
        return results


def main():
    parser = argparse.ArgumentParser(description="ML pipeline: train RF on CSV")
    parser.add_argument("--input", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--output", default="model.joblib")
    parser.add_argument("--drop", nargs="*", default=None)
    parser.add_argument("--fill", default="mean", choices=["mean", "median", "zero"])
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--n-estimators", type=int, default=100)
    parser.add_argument("--max-depth", type=int, default=None)
    parser.add_argument("--cv", type=int, default=5)
    args = parser.parse_args()

    pipeline = MLPipeline(
        n_estimators=args.n_estimators,
        max_depth=args.max_depth,
    )
    results = pipeline.run(
        input_path=args.input,
        target_col=args.target,
        output_path=args.output,
        drop_cols=args.drop,
        fill_strategy=args.fill,
        test_size=args.test_size,
        cv=args.cv,
    )

    print(f"Model saved to {args.output}")
    print(f"CV accuracy: {results['mean_accuracy']:.4f} +/- {results['std_accuracy']:.4f}")
    print(f"Per-fold: {[f'{s:.4f}' for s in results['per_fold']]}")


if __name__ == "__main__":
    main()
