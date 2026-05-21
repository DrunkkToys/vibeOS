import os
import tempfile
import unittest

import joblib
import numpy as np
from sklearn.preprocessing import StandardScaler

from ml_pipeline import MLPipeline


def _make_csv(rows, fieldnames):
    import io
    buf = io.StringIO()
    buf.write(",".join(fieldnames) + "\n")
    for r in rows:
        buf.write(",".join(str(r.get(c, "")) for c in fieldnames) + "\n")
    buf.seek(0)
    return buf


class TestMLPipelineReadCSV(unittest.TestCase):
    def setUp(self):
        self.pipeline = MLPipeline()

    def test_reads_valid_csv(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
            f.write("a,b\n1,2\n3,4\n")
            path = f.name
        rows, fields = self.pipeline.read_csv(path)
        os.unlink(path)
        self.assertEqual(fields, ["a", "b"])
        self.assertEqual(len(rows), 2)

    def test_raises_on_missing_file(self):
        with self.assertRaises(FileNotFoundError):
            self.pipeline.read_csv("/nonexistent/file.csv")

    def test_raises_on_empty(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
            f.write("a,b\n")
            path = f.name
        with self.assertRaises(ValueError):
            self.pipeline.read_csv(path)
        os.unlink(path)


class TestMLPipelineCleanData(unittest.TestCase):
    def setUp(self):
        self.pipeline = MLPipeline()
        self.fieldnames = ["x", "y", "label"]
        self.rows = [
            {"x": "1", "y": "2", "label": "0"},
            {"x": "3", "y": "4", "label": "1"},
            {"x": "5", "y": "6", "label": "0"},
        ]

    def test_basic_clean(self):
        X, y = self.pipeline.clean_data(self.rows, self.fieldnames, "label")
        self.assertEqual(self.pipeline.feature_names, ["x", "y"])
        self.assertEqual(X.shape, (3, 2))
        self.assertEqual(y.shape, (3,))

    def test_skips_missing_target(self):
        rows = self.rows + [{"x": "7", "y": "8", "label": ""}]
        X, y = self.pipeline.clean_data(rows, self.fieldnames, "label")
        self.assertEqual(len(y), 3)

    def test_raises_missing_target_col(self):
        with self.assertRaises(ValueError):
            self.pipeline.clean_data(self.rows, self.fieldnames, "nonexistent")

    def test_raises_no_valid_data(self):
        rows = [{"x": "abc", "y": "def", "label": "0"}]
        with self.assertRaises(ValueError):
            self.pipeline.clean_data(rows, self.fieldnames, "label")

    def test_fill_mean(self):
        rows = [
            {"x": "1", "y": "2", "label": "0"},
            {"x": "", "y": "8", "label": "1"},
        ]
        X, y = self.pipeline.clean_data(rows, self.fieldnames, "label", fill_strategy="mean")
        self.assertFalse(np.isnan(X).any())

    def test_fill_zero(self):
        rows = [
            {"x": "1", "y": "2", "label": "0"},
            {"x": "nan", "y": "8", "label": "1"},
        ]
        X, y = self.pipeline.clean_data(rows, self.fieldnames, "label", fill_strategy="zero")
        self.assertEqual(X[1, 0], 0.0)


class TestMLPipelineSplitData(unittest.TestCase):
    def test_split_shapes(self):
        pipeline = MLPipeline(random_state=0)
        X = np.random.rand(100, 5)
        y = np.random.randint(0, 2, 100)
        Xtr, Xte, ytr, yte = pipeline.split_data(X, y, test_size=0.25)
        self.assertEqual(Xtr.shape[0], 75)
        self.assertEqual(Xte.shape[0], 25)


class TestMLPipelineScaleFeatures(unittest.TestCase):
    def test_zero_mean_unit_variance(self):
        pipeline = MLPipeline()
        Xtr = np.array([[1, 100], [2, 200], [3, 300]], dtype=float)
        Xte = np.array([[1.5, 150]], dtype=float)
        Xtr_s, Xte_s = pipeline.scale_features(Xtr, Xte)
        self.assertAlmostEqual(Xtr_s.mean(axis=0)[0], 0.0, places=10)
        self.assertAlmostEqual(Xtr_s.std(axis=0)[0], 1.0, places=10)
        self.assertEqual(Xte_s.shape, (1, 2))
        self.assertIsNotNone(pipeline.scaler)


class TestMLPipelineTrain(unittest.TestCase):
    def test_model_fits_and_predicts(self):
        pipeline = MLPipeline(n_estimators=10, random_state=0)
        X = np.random.rand(50, 4)
        y = np.random.randint(0, 2, 50)
        model = pipeline.train(X, y)
        preds = model.predict(X)
        self.assertEqual(preds.shape, (50,))
        self.assertIsNotNone(pipeline.model)


class TestMLPipelineEvaluate(unittest.TestCase):
    def test_cv_returns_dict(self):
        pipeline = MLPipeline(n_estimators=10, random_state=0)
        X = np.random.rand(50, 4)
        y = np.random.randint(0, 2, 50)
        pipeline.train(X, y)
        results = pipeline.evaluate(X, y, cv=3)
        self.assertIn("mean_accuracy", results)
        self.assertEqual(len(results["per_fold"]), 3)
        self.assertTrue(0.0 <= results["mean_accuracy"] <= 1.0)
        self.assertIsNotNone(pipeline.cv_results)


class TestMLPipelineSave(unittest.TestCase):
    def test_saves_and_loads(self):
        pipeline = MLPipeline(n_estimators=5)
        pipeline.train(np.random.rand(20, 3), np.random.randint(0, 2, 20))
        scaler = StandardScaler()
        scaler.fit(np.random.rand(20, 3))
        pipeline.scaler = scaler
        pipeline.feature_names = ["a", "b", "c"]
        with tempfile.NamedTemporaryFile(suffix=".joblib", delete=False) as f:
            path = f.name
        pipeline.save(path)
        loaded = joblib.load(path)
        os.unlink(path)
        self.assertIn("model", loaded)
        self.assertIn("scaler", loaded)
        self.assertIn("feature_names", loaded)
        self.assertEqual(loaded["feature_names"], ["a", "b", "c"])

    def test_saves_minimal(self):
        pipeline = MLPipeline(n_estimators=5)
        pipeline.train(np.random.rand(10, 2), np.random.randint(0, 2, 10))
        with tempfile.NamedTemporaryFile(suffix=".joblib", delete=False) as f:
            path = f.name
        pipeline.save(path)
        loaded = joblib.load(path)
        os.unlink(path)
        self.assertIn("model", loaded)
        self.assertNotIn("scaler", loaded)


class TestMLPipelineRun(unittest.TestCase):
    def test_end_to_end(self):
        rows = [{"a": str(i), "b": str(i * 2), "label": str(i % 2)} for i in range(50)]
        header = ["a", "b", "label"]
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
            f.write(",".join(header) + "\n")
            for r in rows:
                f.write(",".join(r[col] for col in header) + "\n")
            csv_path = f.name
        out_path = tempfile.mktemp(suffix=".joblib")
        pipeline = MLPipeline(n_estimators=10, random_state=0)
        results = pipeline.run(csv_path, "label", out_path, cv=3)
        os.unlink(csv_path)
        loaded = joblib.load(out_path)
        os.unlink(out_path)
        self.assertIn("model", loaded)
        self.assertIn("scaler", loaded)
        self.assertIn("mean_accuracy", results)
        self.assertTrue(0.0 <= results["mean_accuracy"] <= 1.0)


if __name__ == "__main__":
    unittest.main()
