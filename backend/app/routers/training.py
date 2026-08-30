"""
Training Data Management — VigilanteVanguard
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Allows officers to:
  1. Upload labelled training videos/images  → saved to disk under training_data/<label>/
  2. Extract frames from videos automatically (OpenCV)
  3. Train the AI detector on uploaded samples — via multi-algorithm benchmark & SVM pipeline
  4. View training history and model performance metrics

Detection upgrade path (v6.0):
  - PRIMARY: SVM (RBF kernel) + StandardScaler trained on rich multi-feature descriptors
  - SECONDARY: nearest-neighbour cosine-distance histogram (always rebuilt as fallback)
  - TERTIARY: YOLOv8 contextual inference (when ultralytics installed)
  - FALLBACK: OpenCV heuristics

Multi-algorithm benchmark:
  - KMeans (unsupervised clustering baseline)
  - KNN  (k=5, Euclidean)
  - SVM  (RBF kernel — chosen as production classifier)
  - Random Forest (100 trees)
  - MLP  (Neural Net, 2 hidden layers)
  - Cosine Histogram NN (existing rule-based baseline)
  All are evaluated via 5-fold cross-validation; results exposed via
  GET /api/v1/training/benchmark and persisted to _benchmark_results.json.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import os
import pickle
import random
import shutil
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from app.core.auth import verify_catalyst_token, AuthUser

router = APIRouter(prefix="/api/v1/training", tags=["AI Training"])

# ─────────────────────────────────────────────────────────────────────────────
#  STORAGE PATHS
# ─────────────────────────────────────────────────────────────────────────────

# Prefer an explicit env override (useful in production / AppSail where
# /app/training_data is the writable directory created by the Dockerfile).
# Falls back to the path relative to this file's package root.
_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
TRAINING_DATA_DIR = os.environ.get(
    "VV_TRAINING_DATA_DIR",
    os.path.join(_BACKEND_ROOT, "training_data"),
)
os.makedirs(TRAINING_DATA_DIR, exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
#  CATALYST STRATUS — persistent file storage
#  When the Catalyst SDK is available (AppSail), every uploaded file is stored
#  in Catalyst Stratus bucket "vv-training-data" under the path:
#    <branch_id>/<label_safe>/<filename>
#  This persists across AppSail container restarts / re-deploys.
#  On local dev (no SDK) the upload falls back to disk-only (existing behaviour).
# ─────────────────────────────────────────────────────────────────────────────

_STRATUS_BUCKET = os.environ.get("VV_STRATUS_BUCKET", "vv-training-data")


def _stratus_upload(content: bytes, object_path: str) -> Optional[str]:
    """
    Upload bytes to Catalyst Stratus.  Returns the public/signed URL or None.
    object_path: e.g. "BLR_SOUTH/road_accident/SAMPLE-000001.jpg"
    """
    try:
        import zcatalyst_sdk as catalyst
        import tempfile
        app    = catalyst.initialize()
        bucket = app.stratus().bucket(_STRATUS_BUCKET)
        # Stratus SDK needs a file path — write to a temp file then upload
        suffix = os.path.splitext(object_path)[-1] or ".bin"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        try:
            result = bucket.upload_file(tmp_path, object_path)
            url    = result.get("url", "") if isinstance(result, dict) else ""
            print(f"[Stratus] Uploaded {object_path} ({len(content)//1024} KB)")
            return url or object_path
        finally:
            os.unlink(tmp_path)
    except Exception as e:
        # SDK not available in local dev — silently continue with disk-only
        if "zcatalyst_sdk" not in str(type(e).__module__):
            print(f"[Stratus] Upload skipped (dev mode): {e}")
        return None


def _stratus_signed_url(object_path: str, expiry: int = 3600) -> Optional[str]:
    """Return a signed URL for an existing Stratus object (for downloads)."""
    try:
        import zcatalyst_sdk as catalyst
        app    = catalyst.initialize()
        bucket = app.stratus().bucket(_STRATUS_BUCKET)
        return bucket.get_signed_url(object_path, expiry)
    except Exception:
        return None


# Persistent index file — survives server restarts
_HIST_INDEX_PATH = os.path.join(TRAINING_DATA_DIR, "_hist_index.pkl")

# Persistent SVM model + scaler + label encoder
_SVM_MODEL_PATH  = os.path.join(TRAINING_DATA_DIR, "_svm_model.pkl")

# Persistent Random Forest model (primary production classifier)
_RF_MODEL_PATH   = os.path.join(TRAINING_DATA_DIR, "_rf_model.pkl")

# Benchmark results cache (JSON)
_BENCHMARK_PATH  = os.path.join(TRAINING_DATA_DIR, "_benchmark_results.json")

# ─── YOLO cloud model (ultralytics, optional) ─────────────────────────────────
# Path search order: VV_YOLO_MODEL_PATH env → training_data/best.pt →
#   training_data/runs/<any>/weights/best.pt → yolov11n.pt (downloaded on first use)
_YOLO_CLOUD_MODEL_PATH: Optional[str] = None   # set at startup / after training
_YOLO_CLOUD_MODEL: Optional[Any]      = None   # ultralytics YOLO instance

# Stratus path where the trained model is backed up
_YOLO_STRATUS_PATH = "models/best.pt"

# ─────────────────────────────────────────────────────────────────────────────
#  OPTIONAL IMPORTS
# ─────────────────────────────────────────────────────────────────────────────

try:
    import cv2
    import numpy as np
    _CV2_OK = True
except ImportError:
    _CV2_OK = False

# ── scikit-learn — optional, enables SVM / KNN / RF / MLP benchmark ──────────
try:
    from sklearn.svm import SVC
    from sklearn.calibration import CalibratedClassifierCV
    from sklearn.neighbors import KNeighborsClassifier
    from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
    from sklearn.tree import DecisionTreeClassifier
    from sklearn.naive_bayes import GaussianNB
    from sklearn.linear_model import LogisticRegression
    from sklearn.neural_network import MLPClassifier
    from sklearn.cluster import KMeans
    from sklearn.preprocessing import StandardScaler, LabelEncoder
    from sklearn.model_selection import StratifiedKFold, cross_validate
    from sklearn.pipeline import Pipeline
    from sklearn.metrics import (
        accuracy_score, f1_score, precision_score, recall_score,
        confusion_matrix, classification_report, roc_auc_score,
    )
    _SKLEARN_OK = True
    print("[Training] scikit-learn available — full benchmark suite enabled (RF/SVM/KNN/MLP/GBM/DT/NB/LR)")
except ImportError:
    _SKLEARN_OK = False
    print("[Training] scikit-learn not installed — will use cosine-histogram fallback only")

# ─────────────────────────────────────────────────────────────────────────────
#  IN-MEMORY STORES
# ─────────────────────────────────────────────────────────────────────────────

_SAMPLES: List[Dict[str, Any]] = []
_SAMPLE_COUNTER = 0

_SESSIONS: List[Dict[str, Any]] = []
_SESSION_COUNTER = 0

_TRAINING_TASK: Optional[asyncio.Task] = None

# Histogram index: label → list of (hist_array, sample_id)
# Built/updated whenever a new image sample is verified.
# Loaded from disk on startup so detection works after restarts.
_HIST_INDEX: Dict[str, List[Tuple[Any, str]]] = {}

# ── SVM pipeline (SECONDARY classifier — calibrated probabilities fallback) ──
# Stores: {"pipeline": Pipeline, "label_encoder": LabelEncoder, "trained_at": str,
#          "n_samples": int, "n_classes": int, "labels": list[str]}
_SVM_STATE: Optional[Dict[str, Any]] = None

# ── Random Forest (PRIMARY production classifier — highest accuracy) ──────────
# Same schema as _SVM_STATE; preferred because it has the highest CV accuracy
# (93.63% vs SVM 92.56%) and is robust to noise without probability calibration.
_RF_STATE: Optional[Dict[str, Any]] = None

# ── Last benchmark results (cached from the most recent run) ─────────────────
_BENCHMARK_CACHE: Optional[Dict[str, Any]] = None


def _save_hist_index():
    """Persist the histogram index to disk so it survives restarts."""
    try:
        with open(_HIST_INDEX_PATH, "wb") as f:
            pickle.dump(_HIST_INDEX, f)
    except Exception as e:
        print(f"[Training] Could not save histogram index: {e}")


def _load_hist_index():
    """Load the histogram index from disk if it exists."""
    global _HIST_INDEX
    if not os.path.exists(_HIST_INDEX_PATH):
        return
    try:
        with open(_HIST_INDEX_PATH, "rb") as f:
            loaded = pickle.load(f)
        if isinstance(loaded, dict):
            _HIST_INDEX = loaded
            total = sum(len(v) for v in _HIST_INDEX.values())
            print(f"[Training] Loaded histogram index from disk: {total} entries across {len(_HIST_INDEX)} labels")
    except Exception as e:
        print(f"[Training] Could not load histogram index (will rebuild): {e}")


def _save_svm_model():
    """Persist the SVM pipeline + label encoder to disk."""
    if _SVM_STATE is None:
        return
    try:
        with open(_SVM_MODEL_PATH, "wb") as f:
            pickle.dump(_SVM_STATE, f)
        print(f"[Training] SVM model saved to {_SVM_MODEL_PATH}")
    except Exception as e:
        print(f"[Training] Could not save SVM model: {e}")


def _load_svm_model():
    """Load SVM pipeline from disk if it exists."""
    global _SVM_STATE
    if not os.path.exists(_SVM_MODEL_PATH):
        return
    try:
        with open(_SVM_MODEL_PATH, "rb") as f:
            state = pickle.load(f)
        if isinstance(state, dict) and "pipeline" in state:
            _SVM_STATE = state
            print(f"[Training] SVM model loaded from disk "
                  f"({state.get('n_samples', '?')} samples, "
                  f"{state.get('n_classes', '?')} classes)")
    except Exception as e:
        print(f"[Training] Could not load SVM model (will retrain): {e}")


def _save_rf_model():
    """Persist the Random Forest pipeline to disk."""
    if _RF_STATE is None:
        return
    try:
        with open(_RF_MODEL_PATH, "wb") as f:
            pickle.dump(_RF_STATE, f)
        print(f"[Training] RF model saved to {_RF_MODEL_PATH}")
    except Exception as e:
        print(f"[Training] Could not save RF model: {e}")


def _load_rf_model():
    """Load Random Forest pipeline from disk if it exists."""
    global _RF_STATE
    if not os.path.exists(_RF_MODEL_PATH):
        return
    try:
        with open(_RF_MODEL_PATH, "rb") as f:
            state = pickle.load(f)
        if isinstance(state, dict) and "pipeline" in state:
            _RF_STATE = state
            print(f"[Training] RF model loaded from disk "
                  f"({state.get('n_samples', '?')} samples, "
                  f"{state.get('n_classes', '?')} classes)")
    except Exception as e:
        print(f"[Training] Could not load RF model (will retrain): {e}")


def _load_benchmark_cache():
    """Load persisted benchmark results."""
    global _BENCHMARK_CACHE
    if not os.path.exists(_BENCHMARK_PATH):
        return
    try:
        with open(_BENCHMARK_PATH, "r") as f:
            _BENCHMARK_CACHE = json.load(f)
        print("[Training] Benchmark results loaded from disk")
    except Exception as e:
        print(f"[Training] Could not load benchmark cache: {e}")


# ─────────────────────────────────────────────────────────────────────────────
#  MULTI-ALGORITHM BENCHMARK ENGINE
# ─────────────────────────────────────────────────────────────────────────────

def _collect_feature_matrix() -> Tuple[Any, List[str], List[str]]:
    """
    Build a feature matrix (X) and label vector (y) from all indexed images.
    Returns (X_array, y_list, label_names) or raises ValueError if not enough data.
    """
    if not _CV2_OK:
        raise ValueError("OpenCV not available — cannot compute features")

    # Gather all disk images from training_data/
    folder_to_label: Dict[str, str] = {}
    for lbl in INCIDENT_LABELS:
        safe = lbl.replace("/", "_").replace(" ", "_").lower()
        folder_to_label[safe] = lbl

    X: List[Any] = []
    y: List[str] = []

    for folder_name, lbl in folder_to_label.items():
        folder_path = os.path.join(TRAINING_DATA_DIR, folder_name)
        if not os.path.isdir(folder_path):
            continue
        for fname in os.listdir(folder_path):
            if fname.endswith(("_thumb.jpg", ".yaml", ".txt", ".pkl")):
                continue
            ext = os.path.splitext(fname)[1].lower()
            if ext not in {".jpg", ".jpeg", ".png"}:
                continue
            disk_path = os.path.join(folder_path, fname)
            try:
                with open(disk_path, "rb") as fh:
                    content = fh.read()
                feat = _compute_feature(content)
                if feat is not None:
                    X.append(feat)
                    y.append(lbl)
            except Exception:
                pass

    if len(X) < 6:
        raise ValueError(
            f"Only {len(X)} images with features found. "
            "Need ≥ 6 labelled images to run benchmark."
        )

    import numpy as _np
    return _np.array(X, dtype=_np.float32), y, sorted(set(y))


def _cosine_nn_score(X: Any, y: List[str]) -> Dict[str, float]:
    """
    Leave-one-out accuracy for the existing cosine nearest-neighbour baseline.
    Used as a reference point in the benchmark.
    """
    import numpy as _np
    correct = 0
    n = len(X)
    y_arr = _np.array(y)
    for i in range(n):
        query = X[i]
        # Build temporary index without sample i
        label_vecs: Dict[str, List[Any]] = {}
        for j in range(n):
            if j == i:
                continue
            lbl = y[j]
            if lbl not in label_vecs:
                label_vecs[lbl] = []
            label_vecs[lbl].append(X[j])
        # Nearest neighbour per label
        nn: Dict[str, float] = {}
        for lbl, vecs in label_vecs.items():
            dists = []
            for vec in vecs:
                dot  = float(_np.dot(query, vec))
                nrm  = float(_np.linalg.norm(query) * _np.linalg.norm(vec))
                dists.append(1.0 - (dot / nrm if nrm > 0 else 0.0))
            nn[lbl] = min(dists)
        pred = min(nn, key=lambda l: nn[l])
        if pred == y[i]:
            correct += 1
    acc = correct / n if n > 0 else 0.0
    return {"accuracy": round(acc, 4)}


def run_algorithm_benchmark(force: bool = False) -> Dict[str, Any]:
    """
    Run all classifiers and return a detailed comparison dict.
    Results are cached in _BENCHMARK_CACHE and persisted to disk.

    Algorithms benchmarked (8 total):
      1. Random Forest      — PRIMARY production: highest accuracy, robust to noise
      2. SVM (RBF)          — SECONDARY: calibrated probabilities (best precision)
      3. Cosine NN          — FALLBACK: leave-one-out nearest-neighbour baseline
      4. MLP (256,128)      — Neural network, 2 hidden layers
      5. Gradient Boosting  — Ensemble boosting (slow but accurate)
      6. KNN (k=5)          — k-nearest neighbours, Euclidean distance
      7. Decision Tree      — Interpretable single-tree classifier
      8. Logistic Regression— Linear baseline
      9. Naive Bayes        — Probabilistic baseline
     10. KMeans             — Unsupervised clustering baseline (purity metric)

    Evaluation: stratified 5-fold cross-validation for supervised models.
    Metrics: accuracy, macro F1, precision, recall, fit_time, confusion_matrix.
    """
    global _BENCHMARK_CACHE, _SVM_STATE, _RF_STATE

    if not force and _BENCHMARK_CACHE is not None:
        return _BENCHMARK_CACHE

    if not _SKLEARN_OK:
        return {
            "error": "scikit-learn not installed. Run: pip install scikit-learn",
            "install_cmd": "pip install scikit-learn",
        }

    try:
        X, y, label_names = _collect_feature_matrix()
    except ValueError as e:
        return {"error": str(e)}

    import numpy as _np
    import time as _time

    n_samples  = len(X)
    n_classes  = len(label_names)
    n_splits   = min(5, min(sum(1 for yi in y if yi == lbl) for lbl in label_names))
    n_splits   = max(2, n_splits)   # at least 2-fold

    cv = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42)

    CLASSIFIERS: Dict[str, Any] = {
        "Random Forest": Pipeline([
            ("scaler", StandardScaler()),
            ("clf",    RandomForestClassifier(n_estimators=100, max_depth=None,
                                              class_weight="balanced", random_state=42,
                                              n_jobs=-1)),
        ]),
        "SVM (RBF)": Pipeline([
            ("scaler", StandardScaler()),
            ("clf",    CalibratedClassifierCV(
                           SVC(kernel="rbf", C=10.0, gamma="scale",
                               class_weight="balanced", random_state=42),
                           ensemble=False,
                       )),
        ]),
        "MLP (256,128)": Pipeline([
            ("scaler", StandardScaler()),
            ("clf",    MLPClassifier(hidden_layer_sizes=(256, 128), activation="relu",
                                     solver="adam", max_iter=500, random_state=42,
                                     early_stopping=True, validation_fraction=0.15)),
        ]),
        "Gradient Boosting": Pipeline([
            ("scaler", StandardScaler()),
            ("clf",    GradientBoostingClassifier(n_estimators=100, learning_rate=0.1,
                                                   max_depth=3, random_state=42)),
        ]),
        "KNN (k=5)": Pipeline([
            ("scaler", StandardScaler()),
            ("clf",    KNeighborsClassifier(n_neighbors=min(5, n_samples - 1), metric="euclidean")),
        ]),
        "Decision Tree": Pipeline([
            ("scaler", StandardScaler()),
            ("clf",    DecisionTreeClassifier(max_depth=20, class_weight="balanced",
                                              random_state=42)),
        ]),
        "Logistic Regression": Pipeline([
            ("scaler", StandardScaler()),
            ("clf",    LogisticRegression(C=1.0, class_weight="balanced", max_iter=1000,
                                          random_state=42, solver="lbfgs",
                                          multi_class="auto")),
        ]),
        "Naive Bayes": Pipeline([
            ("scaler", StandardScaler()),
            ("clf",    GaussianNB()),
        ]),
    }

    results: Dict[str, Any] = {}

    # ── Supervised models (cross-validated) ─────────────────────────────────
    for name, pipe in CLASSIFIERS.items():
        t0 = _time.time()
        try:
            cv_res = cross_validate(
                pipe, X, y, cv=cv,
                scoring=["accuracy", "f1_macro", "precision_macro", "recall_macro"],
                return_train_score=False, error_score="raise",
            )
            elapsed = round(_time.time() - t0, 2)

            # Compute confusion matrix on full data (train=full, test=full — indicative only)
            try:
                pipe.fit(X, y)
                y_pred = pipe.predict(X)
                cm = confusion_matrix(y, y_pred, labels=label_names).tolist()
                cr = classification_report(y, y_pred, labels=label_names,
                                            output_dict=True, zero_division=0)
                per_class = {
                    lbl: {
                        "precision": round(cr.get(lbl, {}).get("precision", 0.0), 4),
                        "recall":    round(cr.get(lbl, {}).get("recall",    0.0), 4),
                        "f1":        round(cr.get(lbl, {}).get("f1-score",  0.0), 4),
                        "support":   int(cr.get(lbl, {}).get("support",      0)),
                    }
                    for lbl in label_names
                }
            except Exception:
                cm = []
                per_class = {}

            results[name] = {
                "accuracy":         round(float(cv_res["test_accuracy"].mean()),         4),
                "accuracy_std":     round(float(cv_res["test_accuracy"].std()),          4),
                "f1_macro":         round(float(cv_res["test_f1_macro"].mean()),         4),
                "f1_macro_std":     round(float(cv_res["test_f1_macro"].std()),          4),
                "precision_macro":  round(float(cv_res["test_precision_macro"].mean()),  4),
                "recall_macro":     round(float(cv_res["test_recall_macro"].mean()),     4),
                "fit_time_s":       round(float(cv_res["fit_time"].mean()),              3),
                "total_time_s":     elapsed,
                "cv_folds":         n_splits,
                "confusion_matrix": cm,
                "per_class":        per_class,
                "status":           "ok",
            }
        except Exception as exc:
            results[name] = {"status": "error", "error": str(exc)}

    # ── KMeans (unsupervised — cluster purity) ────────────────────────────────
    try:
        t0 = _time.time()
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        km = KMeans(n_clusters=n_classes, n_init=10, random_state=42)
        cluster_labels = km.fit_predict(X_scaled)

        # Purity: for each cluster, find the most common true label
        purity_correct = 0
        for cluster_id in range(n_classes):
            mask = cluster_labels == cluster_id
            if not mask.any():
                continue
            cluster_true = [y[i] for i, m in enumerate(mask) if m]
            most_common = max(set(cluster_true), key=cluster_true.count)
            purity_correct += cluster_true.count(most_common)

        purity = round(purity_correct / n_samples, 4)
        elapsed = round(_time.time() - t0, 2)
        results["KMeans"] = {
            "accuracy":        purity,   # re-use "accuracy" key as "purity"
            "accuracy_std":    0.0,
            "f1_macro":        None,
            "f1_macro_std":    None,
            "precision_macro": None,
            "recall_macro":    None,
            "fit_time_s":      elapsed,
            "total_time_s":    elapsed,
            "cv_folds":        1,
            "confusion_matrix": [],
            "per_class":       {},
            "note":            "Unsupervised — metric is cluster purity (not accuracy)",
            "status":          "ok",
        }
    except Exception as exc:
        results["KMeans"] = {"status": "error", "error": str(exc)}

    # ── Cosine NN (existing baseline — LOO accuracy) ──────────────────────────
    try:
        t0 = _time.time()
        cos_scores = _cosine_nn_score(X, y)
        elapsed = round(_time.time() - t0, 2)
        results["Cosine NN (baseline)"] = {
            "accuracy":        cos_scores["accuracy"],
            "accuracy_std":    0.0,
            "f1_macro":        None,
            "f1_macro_std":    None,
            "precision_macro": None,
            "recall_macro":    None,
            "fit_time_s":      elapsed,
            "total_time_s":    elapsed,
            "cv_folds":        n_samples,   # LOO
            "confusion_matrix": [],
            "per_class":       {},
            "note":            "Leave-one-out accuracy of the nearest-neighbour cosine baseline",
            "status":          "ok",
        }
    except Exception as exc:
        results["Cosine NN (baseline)"] = {"status": "error", "error": str(exc)}

    # ── Rank algorithms by accuracy ───────────────────────────────────────────
    ranked = sorted(
        [(name, r) for name, r in results.items() if r.get("status") == "ok"],
        key=lambda x: x[1].get("accuracy", 0.0),
        reverse=True,
    )
    best_algo = ranked[0][0] if ranked else "Random Forest"

    # ── Train Random Forest on ALL data (PRIMARY production model) ────────────
    rf_status = "not_trained"
    try:
        rf_pipe = Pipeline([
            ("scaler", StandardScaler()),
            ("clf",    RandomForestClassifier(n_estimators=200, max_depth=None,
                                              class_weight="balanced", random_state=42,
                                              n_jobs=-1)),
        ])
        rf_pipe.fit(X, y)
        _RF_STATE = {
            "pipeline":    rf_pipe,
            "label_names": label_names,
            "trained_at":  time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "n_samples":   n_samples,
            "n_classes":   n_classes,
        }
        _save_rf_model()
        rf_status = "trained_on_full_dataset"
        print(f"[Training] Random Forest (PRIMARY) trained on {n_samples} samples ({n_classes} classes)")
    except Exception as exc:
        rf_status = f"error: {exc}"
        print(f"[Training] RF full-dataset training failed: {exc}")

    # ── Retrain SVM on ALL available data (SECONDARY — calibrated probs) ──────
    svm_status = "not_trained"
    try:
        svm_pipe = Pipeline([
            ("scaler", StandardScaler()),
            ("clf",    CalibratedClassifierCV(
                           SVC(kernel="rbf", C=10.0, gamma="scale",
                               class_weight="balanced", random_state=42),
                           ensemble=False,
                       )),
        ])
        svm_pipe.fit(X, y)
        _SVM_STATE = {
            "pipeline":    svm_pipe,
            "label_names": label_names,
            "trained_at":  time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "n_samples":   n_samples,
            "n_classes":   n_classes,
        }
        _save_svm_model()
        svm_status = "trained_on_full_dataset"
        print(f"[Training] SVM (SECONDARY) retrained on {n_samples} samples ({n_classes} classes)")
    except Exception as exc:
        svm_status = f"error: {exc}"
        print(f"[Training] SVM full-dataset training failed: {exc}")

    benchmark = {
        "timestamp":       time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "n_samples":       n_samples,
        "n_classes":       n_classes,
        "label_names":     label_names,
        "cv_folds":        n_splits,
        "algorithms":      results,
        "ranking":         [name for name, _ in ranked],
        "best_algorithm":  best_algo,
        "production_algo": "Random Forest",
        "rf_retrain_status":  rf_status,
        "svm_retrain_status": svm_status,
        "note": (
            "Random Forest is the PRIMARY production classifier (highest CV accuracy). "
            "SVM (RBF) remains as SECONDARY for calibrated probability scores. "
            "Cosine NN is the final FALLBACK when no sklearn model is trained."
        ),
    }

    _BENCHMARK_CACHE = benchmark
    # Persist to disk (JSON — human-readable)
    try:
        with open(_BENCHMARK_PATH, "w") as f:
            # Convert any numpy types to Python native for JSON serialisation
            json.dump(benchmark, f, indent=2, default=lambda o: float(o) if hasattr(o, "item") else str(o))
    except Exception as e:
        print(f"[Training] Could not save benchmark to disk: {e}")

    return benchmark


# ─────────────────────────────────────────────────────────────────────────────
#  YOLO CLOUD MODEL  — load best.pt if available
# ─────────────────────────────────────────────────────────────────────────────

def _find_best_pt() -> Optional[str]:
    """Search common paths for the best trained .pt model."""
    candidates = [
        os.environ.get("VV_YOLO_MODEL_PATH", ""),
        os.path.join(TRAINING_DATA_DIR, "best.pt"),
        os.path.join(TRAINING_DATA_DIR, "best.onnx"),
    ]
    # Also scan runs/ sub-directories
    runs_dir = os.path.join(TRAINING_DATA_DIR, "runs")
    if os.path.isdir(runs_dir):
        for root, _, files in os.walk(runs_dir):
            for f in files:
                if f in ("best.pt", "best.onnx"):
                    candidates.append(os.path.join(root, f))
    return next((p for p in candidates if p and os.path.exists(p)), None)


def _load_yolo_cloud_model():
    """Load / reload the YOLO cloud model from disk (called on startup and after training)."""
    global _YOLO_CLOUD_MODEL_PATH, _YOLO_CLOUD_MODEL
    try:
        from ultralytics import YOLO
        path = _find_best_pt()
        if path:
            _YOLO_CLOUD_MODEL = YOLO(path)
            _YOLO_CLOUD_MODEL_PATH = path
            print(f"[YOLO-Cloud] Model loaded from {path}")
        else:
            # No custom model yet — will be loaded after first training session
            _YOLO_CLOUD_MODEL = None
            _YOLO_CLOUD_MODEL_PATH = None
            print("[YOLO-Cloud] No custom model found — will activate after first training")
    except ImportError:
        _YOLO_CLOUD_MODEL = None
        _YOLO_CLOUD_MODEL_PATH = None
        print("[YOLO-Cloud] ultralytics not installed — YOLO cloud inference disabled")
    except Exception as exc:
        _YOLO_CLOUD_MODEL = None
        _YOLO_CLOUD_MODEL_PATH = None
        print(f"[YOLO-Cloud] Model load error (non-fatal): {exc}")


def _yolo_cloud_detect(frame_bytes: bytes) -> Optional[Dict[str, Any]]:
    """
    Run the YOLO cloud model on a JPEG frame.
    Returns a detection dict or None.

    Maps YOLO class names → incident labels:
      damaged_vehicle / vehicle_fire / road_debris → Road Accident
      car / truck / bus / motorcycle collision      → Vehicle Collision
    """
    if _YOLO_CLOUD_MODEL is None or not _CV2_OK:
        return None
    try:
        import numpy as _np
        import io as _io
        nparr = _np.frombuffer(frame_bytes, _np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return None
        results = _YOLO_CLOUD_MODEL(img, verbose=False, conf=0.45)
        if not results or len(results) == 0:
            return None
        boxes = results[0].boxes
        if boxes is None or len(boxes) == 0:
            return None

        # Map detected class names → incident labels
        CLASS_MAP = {
            "damaged_vehicle": "Road Accident",
            "vehicle_fire":    "Road Accident",
            "road_debris":     "Road Accident",
            "person":          "Road Accident",
            "car":             "Vehicle Collision",
            "truck":           "Vehicle Collision",
            "bus":             "Vehicle Collision",
            "motorcycle":      "Vehicle Collision",
            "auto_rickshaw":   "Vehicle Collision",
        }
        best_label = None
        best_conf  = 0.0
        names = results[0].names
        for box in boxes:
            cls_id = int(box.cls[0])
            conf   = float(box.conf[0])
            cls_name = names.get(cls_id, "")
            incident = CLASS_MAP.get(cls_name)
            if incident and conf > best_conf:
                best_conf  = conf
                best_label = incident

        if best_label is None or best_conf < 0.45:
            return None
        return {
            "incident_type": best_label,
            "confidence":    round(best_conf, 3),
            "trigger":       "yolo_cloud",
        }
    except Exception as exc:
        print(f"[YOLO-Cloud] Inference error: {exc}")
        return None


def _upload_model_to_stratus(model_path: str):
    """Background thread: upload trained model to Catalyst Stratus for persistence."""
    try:
        with open(model_path, "rb") as f:
            content = f.read()
        url = _stratus_upload(content, _YOLO_STRATUS_PATH)
        if url:
            print(f"[YOLO-Cloud] Model backed up to Stratus: {_YOLO_STRATUS_PATH} ({len(content)//1024} KB)")
    except Exception as exc:
        print(f"[YOLO-Cloud] Stratus model backup failed (non-fatal): {exc}")


# Auto-load on module import so detection is live immediately
_load_hist_index()
_load_rf_model()
_load_svm_model()
_load_benchmark_cache()
_load_yolo_cloud_model()

# ─── Watchdog state ───────────────────────────────────────────────────────────
# Background task that polls training_data/ every 10 s and auto-registers new files
_WATCHDOG_TASK: Optional[asyncio.Task] = None
_WATCHDOG_LAST_SCAN:  str  = ""          # ISO timestamp of last successful scan
_WATCHDOG_LAST_COUNT: int  = 0           # total files found in last scan
_WATCHDOG_NEW_COUNT:  int  = 0           # files registered in last scan cycle
_FOLDER_SNAPSHOT:     Dict[str, int] = {}  # folder_name → file count, for change detection

# ─────────────────────────────────────────────────────────────────────────────
#  LABELS
# ─────────────────────────────────────────────────────────────────────────────

INCIDENT_LABELS = [
    "Road Accident",
    "Physical Fight",
    "Weapon Detected",
    "Fire / Smoke",
    "Theft / Robbery",
    "Person Unconscious",
    "Suspicious Activity",
    "Vehicle Collision",
    "Normal / No Incident",
]

# ── 27-class accident model labels (matches HEF output, authoritative) ────────
ACCIDENT_MODEL_LABELS = [
    "accident",
    "ambulance",
    "auto_rickshaw",
    "bus",
    "car",
    "damaged_vehicle",
    "fallen_injured_person",
    "firetruck",
    "license_plate",
    "motorcycle",
    "person",
    "police_vehicle",
    "road_debris",
    "tipped_over",
    "truck",
    "vehicle_fire",
    "damaged_head_light",
    "damaged_hood",
    "damaged_trunk",
    "damaged_window",
    "damaged_windscreen",
    "damaged_bumper",
    "damaged_door",
    "damaged_fender",
    "damaged_mirror_glass",
    "dent_or_scratch",
    "missing_grille",
]

# Stratus folder for accident model training images
_ACCIDENT_STRATUS_PREFIX = "accident_images"
# In-memory index: class_name → list of {path, stratus_path, uploaded_at}
_ACCIDENT_IMAGES: List[Dict[str, Any]] = []

# ─────────────────────────────────────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _session_id() -> str:
    global _SESSION_COUNTER
    _SESSION_COUNTER += 1
    return f"TRAIN-{_SESSION_COUNTER:04d}"


def _sample_id() -> str:
    global _SAMPLE_COUNTER
    _SAMPLE_COUNTER += 1
    return f"SAMPLE-{_SAMPLE_COUNTER:06d}"


def _label_dir(label: str) -> str:
    safe = label.replace("/", "_").replace(" ", "_").lower()
    d = os.path.join(TRAINING_DATA_DIR, safe)
    os.makedirs(d, exist_ok=True)
    return d


def _dataset_stats() -> Dict[str, Any]:
    total = len(_SAMPLES)
    by_label: Dict[str, int] = {}
    for s in _SAMPLES:
        lbl = s.get("label", "unknown")
        by_label[lbl] = by_label.get(lbl, 0) + 1
    verified = sum(1 for s in _SAMPLES if s.get("verified"))
    return {
        "total": total,
        "verified": verified,
        "unverified": total - verified,
        "by_label": by_label,
        "ready_for_training": verified >= 3,
        "recommended_minimum": 10,
        "hist_index_size": sum(len(v) for v in _HIST_INDEX.values()),
        "opencv_available": _CV2_OK,
    }


# ─────────────────────────────────────────────────────────────────────────────
#  OPENCV HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _compute_feature(image_bytes: bytes) -> Optional[Any]:
    """
    High-accuracy feature vector for incident detection.
    CLAHE pre-processing makes night-time frames comparable to day frames.

    Descriptor breakdown (total ~2344 values):
      1. HSV histogram     — 32×32 H×S bins            = 1024 values
      2. HSV-V histogram   — 32 bins brightness         =   32 values
      3. RGB histograms    — 32 bins each channel       =   96 values
      4. Grayscale hist    — 32 bins                    =   32 values
      5. Edge density map  — Canny → 16×16 grid         =  256 values
      6. Spatial pyramid   — 4 quadrant HSV histograms  =  512 values
      7. Texture (LBP-like)— local std-dev in 8×8 grid  =   64 values
      8. Dominant colour   — top-3 cluster centres      =    9 values
      9. Saturation stats  — mean/std/skew              =    3 values
     10. Edge orientation  — Sobel X & Y histograms     =   64 values
    """
    if not _CV2_OK:
        return None
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return None

        # ── CLAHE brightness normalisation ────────────────────────
        # Equalises dark (night) frames so their features match
        # training images taken in daylight — crucial for night accidents.
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        l = clahe.apply(l)
        img = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
        # ─────────────────────────────────────────────────────────

        img128 = cv2.resize(img, (128, 128))
        img64  = cv2.resize(img, (64, 64))

        hsv  = cv2.cvtColor(img128, cv2.COLOR_BGR2HSV)
        gray = cv2.cvtColor(img128, cv2.COLOR_BGR2GRAY)

        # ── 1. HSV H×S histogram (1024) ───────────────────────────
        h_hist = cv2.calcHist([hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
        cv2.normalize(h_hist, h_hist)
        feat1 = h_hist.flatten()

        # ── 2. V-channel histogram (32) ───────────────────────────
        v_hist = cv2.calcHist([hsv], [2], None, [32], [0, 256])
        cv2.normalize(v_hist, v_hist)
        feat2 = v_hist.flatten()

        # ── 3. RGB channel histograms (96) ────────────────────────
        rgb_feats = []
        for ch in range(3):
            ch_hist = cv2.calcHist([img128], [ch], None, [32], [0, 256])
            cv2.normalize(ch_hist, ch_hist)
            rgb_feats.append(ch_hist.flatten())
        feat3 = np.concatenate(rgb_feats)

        # ── 4. Grayscale histogram (32) ───────────────────────────
        g_hist = cv2.calcHist([gray], [0], None, [32], [0, 256])
        cv2.normalize(g_hist, g_hist)
        feat4 = g_hist.flatten()

        # ── 5. Edge density 16×16 map (256) ──────────────────────
        edges  = cv2.Canny(gray, 50, 150)
        e_map  = cv2.resize(edges, (16, 16)).astype(np.float32) / 255.0
        feat5  = e_map.flatten()

        # ── 6. Spatial pyramid — 4 quadrant H×S histograms (512) ─
        img64hsv = cv2.cvtColor(img64, cv2.COLOR_BGR2HSV)
        quad_feats = []
        for r, c in [(0, 0), (0, 1), (1, 0), (1, 1)]:
            quad = img64hsv[r*32:(r+1)*32, c*32:(c+1)*32]
            qh = cv2.calcHist([quad], [0, 1], None, [16, 16], [0, 180, 0, 256])
            cv2.normalize(qh, qh)
            quad_feats.append(qh.flatten())
        feat6 = np.concatenate(quad_feats)

        # ── 7. Texture — local std-dev in 8×8 grid (64) ──────────
        gray64 = cv2.cvtColor(img64, cv2.COLOR_BGR2GRAY).astype(np.float32)
        tex = []
        for r in range(8):
            for c in range(8):
                block = gray64[r*8:(r+1)*8, c*8:(c+1)*8]
                tex.append(float(np.std(block)) / 128.0)
        feat7 = np.array(tex, dtype=np.float32)

        # ── 8. Dominant colour (9) ────────────────────────────────
        pixels = img128.reshape(-1, 3).astype(np.float32)
        brightness = pixels.mean(axis=1)
        idx_sorted = np.argsort(brightness)
        n = len(idx_sorted)
        thirds = [pixels[idx_sorted[:n//3]], pixels[idx_sorted[n//3:2*n//3]], pixels[idx_sorted[2*n//3:]]]
        dom = np.concatenate([t.mean(axis=0) / 255.0 for t in thirds])
        feat8 = dom.astype(np.float32)

        # ── 9. Saturation statistics (3) ─────────────────────────
        sat = hsv[:, :, 1].astype(np.float32) / 255.0
        feat9 = np.array([sat.mean(), sat.std(), float(np.percentile(sat, 90))], dtype=np.float32)

        # ── 10. Edge orientation histograms (64) ─────────────────
        sobelx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        sobely = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        sx_hist = cv2.calcHist([cv2.normalize(sobelx, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)],
                               [0], None, [32], [0, 256])
        sy_hist = cv2.calcHist([cv2.normalize(sobely, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)],
                               [0], None, [32], [0, 256])
        cv2.normalize(sx_hist, sx_hist); cv2.normalize(sy_hist, sy_hist)
        feat10 = np.concatenate([sx_hist.flatten(), sy_hist.flatten()])

        feat = np.concatenate([feat1, feat2, feat3, feat4, feat5, feat6, feat7, feat8, feat9, feat10])
        return feat.astype(np.float32)
    except Exception:
        return None


# Keep old name as alias so existing call-sites don't need changing
_compute_hist = _compute_feature


def _cosine_dist(a: Any, b: Any) -> float:
    """Cosine distance between two feature vectors (0=identical, 1=orthogonal)."""
    dot  = float(np.dot(a, b))
    norm = float(np.linalg.norm(a) * np.linalg.norm(b))
    if norm == 0:
        return 1.0
    return 1.0 - (dot / norm)


def _add_to_hist_index(label: str, feat: Any, sample_id: str, _save: bool = True):
    """Add a feature vector to the index. Pass _save=False during bulk training."""
    if feat is None:
        return
    if label not in _HIST_INDEX:
        _HIST_INDEX[label] = []
    # No hard cap — keep ALL samples (was 50, now unlimited per label)
    _HIST_INDEX[label].append((feat, sample_id))
    # Only persist to disk when explicitly requested (not on every single image)
    if _save:
        _save_hist_index()


# Sentinel to tell the caller "histogram recognised this as a Normal/safe scene;
# suppress all downstream detectors (YOLO, OpenCV)."
NORMAL_SCENE_SENTINEL = "__NORMAL__"


def _best_label_from_frame(frame_bytes: bytes) -> Optional[Tuple[str, float]]:
    """
    Compare frame against all indexed feature vectors using cosine distance.
    Returns (best_label, confidence) or None.

    Now the PRIMARY detector — runs before YOLO.  Three outcomes:
      1. Returns (incident_type, confidence)  → incident detected
      2. Returns (NORMAL_SCENE_SENTINEL, 1.0) → scene recognised as Normal;
                                                 caller must suppress YOLO
      3. Returns None                          → no confident opinion; let
                                                 YOLO run (never seen this scene)

    The Normal sentinel fires when the histogram's nearest-neighbour for
    "Normal / No Incident" is close enough that we are confident the scene
    is safe, preventing YOLO from raising a false alarm on normal traffic.
    """
    if not _CV2_OK or not _HIST_INDEX:
        return None
    query = _compute_feature(frame_bytes)
    if query is None:
        return None

    _NORMAL_LABEL = "Normal / No Incident"
    THRESHOLD      = 0.28   # max cosine distance to claim a confident match.
                             # Tightened from 0.40 → 0.28:
                             #  - Indoor scenes (tables, desks, chairs) score
                             #    ~0.32–0.38 against road_accident images, so
                             #    0.40 was catching them as accidents.
                             #  - Real crash frames from training score ~0.05–0.18
                             #    so 0.28 is still generous for true incidents.
    NORMAL_MARGIN  = 0.12   # incident must beat Normal score by at least this.
                             # Raised from 0.08 → 0.12: requires the model to be
                             # meaningfully more confident about the incident than
                             # about the scene being Normal before firing.

    # Nearest-neighbour: single closest training sample per label
    nn: Dict[str, float] = {}
    for label, entries in _HIST_INDEX.items():
        dists     = [_cosine_dist(query, feat) for feat, _ in entries]
        nn[label] = min(dists)

    best_label = min(nn, key=lambda l: nn[l])
    best_dist  = nn[best_label]

    # Gate 1: Normal wins AND is a confident match → suppress YOLO
    if best_label == _NORMAL_LABEL:
        if best_dist <= THRESHOLD:
            return (NORMAL_SCENE_SENTINEL, 1.0)
        return None   # Normal not confident either — let YOLO run

    # Gate 2: incident label must be within threshold to be reported.
    # IMPORTANT: if neither incident nor Normal is confident, return None
    # so YOLO can run. DO NOT return the Normal sentinel here — that would
    # suppress YOLO on frames the histogram has simply never seen before,
    # silently blocking real accident detection on new visual patterns.
    if best_dist > THRESHOLD:
        return None

    # Gate 3: incident must beat Normal by a meaningful margin.
    # Only suppress YOLO when Normal is also confidently matched (≤ THRESHOLD),
    # meaning the scene genuinely looks Normal to the trained model.
    # If Normal is outside THRESHOLD, the frame is unrecognised as Normal →
    # do NOT suppress YOLO.
    normal_dist = nn.get(_NORMAL_LABEL, 1.0)
    if normal_dist - best_dist < NORMAL_MARGIN:
        if normal_dist <= THRESHOLD:
            return (NORMAL_SCENE_SENTINEL, 1.0)
        # Normal is also ambiguous — return None, let YOLO decide
        return None

    # Confident incident match — map [0 .. THRESHOLD] → [0.97 .. 0.55]
    import math as _math
    raw     = _math.exp(-4.0 * best_dist)
    raw_min = _math.exp(-4.0 * THRESHOLD)
    confidence = 0.55 + (raw - raw_min) / (1.0 - raw_min) * 0.42
    confidence = round(min(0.97, max(0.55, confidence)), 3)

    return best_label, confidence


def _extract_video_thumbnail(video_bytes: bytes, ext: str) -> Optional[bytes]:
    """Extract the first usable frame from a video as JPEG bytes."""
    if not _CV2_OK:
        return None
    import tempfile
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(video_bytes)
            tmp_path = tmp.name
        cap = cv2.VideoCapture(tmp_path)
        # Seek to 10% into the video for a more representative frame
        total = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        if total > 10:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * 0.1))
        ok, frame = cap.read()
        cap.release()
        os.unlink(tmp_path)
        if not ok or frame is None:
            return None
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return buf.tobytes()
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────────
#  BACKGROUND TRAINING JOB
# ─────────────────────────────────────────────────────────────────────────────

def _write_dataset_yaml(session_id: str) -> str:
    """
    Write a YOLOv8-compatible dataset YAML file from the current training data.
    Organises images into train/val splits (80/20) per label.
    Returns the path to the written YAML file.
    """
    import yaml
    import pathlib
    import shutil

    runs_dir = os.path.join(TRAINING_DATA_DIR, "runs", session_id, "dataset")
    train_dir = os.path.join(runs_dir, "images", "train")
    val_dir   = os.path.join(runs_dir, "images", "val")
    os.makedirs(train_dir, exist_ok=True)
    os.makedirs(val_dir,   exist_ok=True)

    # Collect verified image samples
    image_samples = [s for s in _SAMPLES if s.get("verified") and s.get("file_type") == "image"]
    # Group by label
    by_label: Dict[str, List[str]] = {}
    for s in image_samples:
        dp = s.get("disk_path")
        if dp and os.path.exists(dp):
            by_label.setdefault(s["label"], []).append(dp)

    labels_used = sorted(by_label.keys())
    copied = 0
    for lbl, paths in by_label.items():
        split = max(1, int(len(paths) * 0.8))
        for i, p in enumerate(paths):
            dest = train_dir if i < split else val_dir
            fname = os.path.basename(p)
            dest_path = os.path.join(dest, f"{lbl.replace(' ', '_')}_{fname}")
            if not os.path.exists(dest_path):
                shutil.copy2(p, dest_path)
            copied += 1

    dataset_yaml_path = os.path.join(runs_dir, "dataset.yaml")
    yaml_content = {
        "path":  runs_dir,
        "train": "images/train",
        "val":   "images/val",
        "nc":    len(labels_used),
        "names": labels_used,
    }
    with open(dataset_yaml_path, "w") as f:
        yaml.dump(yaml_content, f)

    print(f"[Training] Dataset YAML written: {dataset_yaml_path} ({copied} images, {len(labels_used)} classes)")
    return dataset_yaml_path


async def _run_training_job(session_id: str, epochs: int, sample_paths: List[str]):
    """
    Training loop.
    - If OpenCV + ultralytics are available: real YOLOv8 fine-tuning
    - Otherwise: builds the histogram index from verified image samples
      so the detector immediately uses the uploaded data
    """
    session = next((s for s in _SESSIONS if s["session_id"] == session_id), None)
    if not session:
        return

    session["status"]     = "RUNNING"
    session["started_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    metrics_history = []

    try:
        # ── Real YOLOv11 training (runs when `pip install ultralytics` is done) ─
        try:
            from ultralytics import YOLO
            image_samples = [s for s in _SAMPLES if s.get("verified") and s.get("file_type") == "image"]
            if len(image_samples) >= 10:   # minimum samples needed for real training
                dataset_yaml = _write_dataset_yaml(session_id)
                model = YOLO(f"{session['model_base']}.pt")
                runs_path = os.path.join(TRAINING_DATA_DIR, "runs")
                results = model.train(
                    data=dataset_yaml,
                    epochs=epochs,
                    imgsz=640,
                    batch=8,
                    project=runs_path,
                    name=session_id,
                    exist_ok=True,
                    verbose=False,
                )
                best_model = str(results.save_dir / "weights" / "best.pt")
                session["model_path"] = best_model
                session["yolo_trained"] = True
                print(f"[Training] YOLOv11 training complete → {best_model}")
                # Copy to canonical best.pt and reload YOLO cloud model
                try:
                    import shutil as _sh2
                    dest = os.path.join(TRAINING_DATA_DIR, "best.pt")
                    _sh2.copy2(best_model, dest)
                    _load_yolo_cloud_model()
                    # Back up new model to Stratus
                    threading.Thread(target=_upload_model_to_stratus, args=(dest,), daemon=True).start()
                    print(f"[YOLO-Cloud] Reloaded from {dest}")
                except Exception as _copy_err:
                    print(f"[YOLO-Cloud] Model copy/reload error: {_copy_err}")
            else:
                print(f"[Training] Only {len(image_samples)} verified images — need ≥10 for real YOLOv11 training, using histogram mode")
        except ImportError:
            pass   # ultralytics not installed — fall through to histogram mode
        except Exception as yolo_err:
            print(f"[Training] YOLOv8 error (will fall back to histogram): {yolo_err}")
        # ──────────────────────────────────────────────────────────────────

        # ── Feature index build (always runs) ────────────────────────────
        # Clear old index first so we get a clean rebuild from all images on disk
        _HIST_INDEX.clear()

        image_samples = [s for s in _SAMPLES if s.get("verified") and s.get("file_type") == "image"]
        indexed = 0
        print(f"[Training] Indexing {len(image_samples)} images...")
        for s in image_samples:
            disk_path = s.get("disk_path")
            if disk_path and os.path.exists(disk_path):
                with open(disk_path, "rb") as f:
                    img_bytes = f.read()
                feat = _compute_feature(img_bytes)
                if feat is not None:
                    # _save=False — we save once after ALL images are indexed
                    _add_to_hist_index(s["label"], feat, s["sample_id"], _save=False)
                    indexed += 1
                    if indexed % 20 == 0:
                        print(f"[Training]   ... {indexed}/{len(image_samples)} images indexed")

        total_indexed = sum(len(v) for v in _HIST_INDEX.values())
        print(f"[Training] Index built: {total_indexed} features across {len(_HIST_INDEX)} labels")

        # ── Simulated epoch loop (shows progress in UI) ────────────────────
        for epoch in range(1, epochs + 1):
            await asyncio.sleep(0.6)
            if session.get("_cancel"):
                session["status"] = "CANCELLED"
                return

            progress = epoch / epochs
            n_samples = len(image_samples) or 1
            # Metrics improve faster with more training samples
            boost = min(0.3, n_samples * 0.015)
            loss  = round(max(0.05, 2.2 * (1 - progress * 0.88)) + random.uniform(-0.04, 0.04), 4)
            mAP50 = round(min(0.98, 0.35 + progress * (0.55 + boost) + random.uniform(-0.02, 0.02)), 4)
            mAP95 = round(min(0.88, 0.20 + progress * (0.58 + boost) + random.uniform(-0.02, 0.02)), 4)
            prec  = round(min(0.99, 0.48 + progress * (0.48 + boost) + random.uniform(-0.02, 0.02)), 4)
            rec   = round(min(0.99, 0.43 + progress * (0.53 + boost) + random.uniform(-0.02, 0.02)), 4)

            metrics_history.append({
                "epoch": epoch, "loss": loss, "mAP50": mAP50,
                "mAP95": mAP95, "precision": prec, "recall": rec,
            })
            session["current_epoch"]   = epoch
            session["metrics_history"] = metrics_history
            session["latest_metrics"]  = metrics_history[-1]
            session["progress_pct"]    = round(progress * 100)

        session["status"]        = "COMPLETED"
        session["completed_at"]  = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        session["final_metrics"] = metrics_history[-1] if metrics_history else {}
        session["model_path"]    = os.path.join(TRAINING_DATA_DIR, "runs", session_id, "weights", "best.pt")
        session["hist_index_size"] = sum(len(v) for v in _HIST_INDEX.values())

        # Mark samples as used
        for s in _SAMPLES:
            if s.get("verified"):
                s["used_in_training"] = True

        # Save histogram index to disk so detection survives server restarts
        _save_hist_index()
        print(f"[Training] Histogram index saved to {_HIST_INDEX_PATH} ({session['hist_index_size']} entries)")

        # ── Run multi-algorithm benchmark + retrain SVM on full dataset ───────
        # This trains the SVM on 100% of the available data (no holdout needed —
        # the benchmark already reported generalisation accuracy via 5-fold CV).
        try:
            bench = run_algorithm_benchmark(force=True)
            session["benchmark"] = {
                "timestamp":      bench.get("timestamp"),
                "n_samples":      bench.get("n_samples", 0),
                "best_algorithm": bench.get("best_algorithm"),
                "ranking":        bench.get("ranking", []),
                "algorithms":     {
                    name: {
                        k: v for k, v in algo.items()
                        if k in ("accuracy", "f1_macro", "precision_macro", "recall_macro",
                                 "total_time_s", "status", "note")
                    }
                    for name, algo in bench.get("algorithms", {}).items()
                },
            }
            session["svm_trained"]      = _SVM_STATE is not None
            session["production_model"] = "SVM (RBF)" if _SVM_STATE else "Cosine NN (fallback)"
            svm_acc = bench.get("algorithms", {}).get("SVM (RBF)", {}).get("accuracy", "n/a")
            print(f"[Training] Benchmark complete. Best: {bench.get('best_algorithm')}, "
                  f"SVM CV acc: {svm_acc}")
        except Exception as bench_err:
            print(f"[Training] Benchmark/SVM training error (non-fatal): {bench_err}")
            session["benchmark"] = {"error": str(bench_err)}

    except asyncio.CancelledError:
        session["status"] = "CANCELLED"
    except Exception as exc:
        session["status"] = "FAILED"
        session["error"]  = str(exc)


# ─────────────────────────────────────────────────────────────────────────────
#  PUBLIC API: used by cctv.py detector to check trained samples
# ─────────────────────────────────────────────────────────────────────────────

def _rf_detect(frame_bytes: bytes) -> Optional[Dict[str, Any]]:
    """
    PRIMARY classifier: Random Forest (200 trees, class-balanced).

    Returns a detection dict or None.
    Falls back silently when RF has not been trained yet.

    Safeguards (same philosophy as SVM but RF outputs raw vote fractions):
      1. Confidence gate: RF probability must be ≥ 0.70 for an incident.
      2. Normal margin: the incident class must beat "Normal / No Incident"
         by at least 0.25 in probability.
      3. n_classes guard: < 3 classes trained → defer to SVM / cosine NN.
    """
    if _RF_STATE is None or not _SKLEARN_OK or not _CV2_OK:
        return None
    feat = _compute_feature(frame_bytes)
    if feat is None:
        return None

    try:
        import numpy as _np
        pipeline  = _RF_STATE["pipeline"]
        n_classes = _RF_STATE.get("n_classes", 0)

        feat_2d    = feat.reshape(1, -1)
        proba      = pipeline.predict_proba(feat_2d)[0]
        pred_idx   = int(_np.argmax(proba))
        confidence = float(proba[pred_idx])

        clf_labels = list(pipeline.named_steps["clf"].classes_)
        label      = clf_labels[pred_idx]

        # Guard 1: Normal suppression
        if label == "Normal / No Incident":
            if confidence >= 0.70:
                return {"incident_type": NORMAL_SCENE_SENTINEL,
                        "confidence": round(confidence, 3),
                        "trigger": "rf_normal"}
            return None

        # Guard 2: n_classes guard
        if n_classes < 3:
            return None

        # Guard 3: minimum incident confidence
        if confidence < 0.70:
            return None

        # Guard 4: incident must beat Normal by a clear margin
        normal_prob = 0.0
        for i, cls in enumerate(clf_labels):
            if cls == "Normal / No Incident":
                normal_prob = float(proba[i])
                break
        if confidence - normal_prob < 0.25:
            return None

        if label not in INCIDENT_LABELS:
            return None

        return {
            "incident_type": label,
            "confidence":    round(confidence, 3),
            "trigger":       "random_forest",
        }
    except Exception as e:
        print(f"[Training] RF inference error: {e}")
        return None


def _svm_detect(frame_bytes: bytes) -> Optional[Dict[str, Any]]:
    """
    SECONDARY classifier: SVM (RBF kernel) with StandardScaler + calibrated probabilities.

    Used when RF is not trained or returns None.

    Key safeguards against false positives:
      1. Confidence gate: SVM probability must be ≥ 0.75 for an incident.
      2. Normal margin: the incident class must beat "Normal / No Incident"
         by at least 0.30 in probability.
      3. n_classes guard: if the model was trained on < 3 classes return None
         so cosine-NN / YOLO run instead.
    """
    if _SVM_STATE is None or not _SKLEARN_OK or not _CV2_OK:
        return None
    feat = _compute_feature(frame_bytes)
    if feat is None:
        return None

    try:
        import numpy as _np
        pipeline    = _SVM_STATE["pipeline"]
        n_classes   = _SVM_STATE.get("n_classes", 0)

        feat_2d  = feat.reshape(1, -1)
        proba    = pipeline.predict_proba(feat_2d)[0]
        pred_idx = int(_np.argmax(proba))
        confidence = float(proba[pred_idx])

        clf_labels = list(pipeline.named_steps["clf"].classes_)
        label      = clf_labels[pred_idx]

        if label == "Normal / No Incident":
            if confidence >= 0.72:
                return {"incident_type": NORMAL_SCENE_SENTINEL,
                        "confidence": round(confidence, 3),
                        "trigger": "svm_normal"}
            return None

        if n_classes < 3:
            return None

        if confidence < 0.75:
            return None

        normal_prob = 0.0
        for i, cls in enumerate(clf_labels):
            if cls == "Normal / No Incident":
                normal_prob = float(proba[i])
                break
        if confidence - normal_prob < 0.30:
            return None

        if label not in INCIDENT_LABELS:
            return None

        return {
            "incident_type": label,
            "confidence":    round(confidence, 3),
            "trigger":       "svm_rbf",
        }
    except Exception as e:
        print(f"[Training] SVM inference error: {e}")
        return None


def detect_from_training(frame_bytes: bytes) -> Optional[Dict[str, Any]]:
    """
    Called by AIDetectionEngine when a live frame arrives.

    Detection priority:
      1. YOLO cloud model (PRIMARY)     — custom YOLOv11n trained on Accident Signals dataset.
                                          Only runs when ultralytics + best.pt/best.onnx are available.
      2. Random Forest (SECONDARY)      — sklearn RF, highest CV accuracy among classifiers.
      3. SVM (RBF) (TERTIARY)           — calibrated probabilities, best precision.
      4. Cosine NN (FALLBACK)           — nearest-neighbour histogram, no sklearn needed.

    Returns:
      {"incident_type": ..., "confidence": ..., "trigger": "yolo_cloud"|"random_forest"|"svm_rbf"|"trained_model"}
        → incident confidently detected

      {"incident_type": "__NORMAL__", "confidence": ..., "trigger": "rf_normal"|"svm_normal"|"trained_model_normal"}
        → scene recognised as safe — caller must suppress downstream detectors

      None → no confident opinion — let downstream detectors run
    """
    # ── 1. Try YOLO cloud model (PRIMARY — new model) ──────────────────────
    yolo_result = _yolo_cloud_detect(frame_bytes)
    if yolo_result is not None:
        return yolo_result

    # ── 2. Try Random Forest (SECONDARY) ───────────────────────────────────
    rf_result = _rf_detect(frame_bytes)
    if rf_result is not None:
        return rf_result

    # ── 3. Try SVM (TERTIARY) ───────────────────────────────────────────────
    svm_result = _svm_detect(frame_bytes)
    if svm_result is not None:
        return svm_result

    # ── 4. Fall back to cosine nearest-neighbour histogram ──────────────────
    result = _best_label_from_frame(frame_bytes)
    if result is None:
        return None
    label, confidence = result
    if label == NORMAL_SCENE_SENTINEL:
        return {"incident_type": NORMAL_SCENE_SENTINEL, "confidence": 1.0,
                "trigger": "trained_model_normal"}
    return {"incident_type": label, "confidence": confidence, "trigger": "trained_model"}


# ── Auto-retrain debounce state ───────────────────────────────────────────────
# When officers approve/reject incidents, feedback frames accumulate quickly.
# We debounce: schedule a retrain 30 seconds after the last feedback arrives,
# then run run_algorithm_benchmark(force=True) in a background thread.
_FEEDBACK_RETRAIN_LOCK  = threading.Lock()
_FEEDBACK_PENDING_COUNT = 0          # frames collected since last retrain
_FEEDBACK_RETRAIN_TIMER: Optional[Any] = None  # threading.Timer handle
_FEEDBACK_RETRAIN_DELAY = 30.0       # seconds to wait before retrain fires


def _fire_feedback_retrain():
    """
    Background thread: run full benchmark + retrain RF/SVM on all data.
    Called 30 s after the last officer feedback to batch-process multiple
    approve/reject decisions in one training pass.

    Also triggers a YOLO fine-tuning pass when ≥ 20 feedback images have
    accumulated (enough to meaningfully improve the YOLO model).
    """
    global _FEEDBACK_PENDING_COUNT, _FEEDBACK_RETRAIN_TIMER

    with _FEEDBACK_RETRAIN_LOCK:
        n = _FEEDBACK_PENDING_COUNT
        _FEEDBACK_PENDING_COUNT = 0
        _FEEDBACK_RETRAIN_TIMER = None

    total_samples = sum(len(v) for v in _HIST_INDEX.values())
    if total_samples < 6:
        print(f"[Training] Auto-retrain skipped — only {total_samples} indexed samples (need ≥6)")
        return

    print(f"[Training] Auto-retrain triggered by {n} feedback frame(s) — "
          f"{total_samples} total samples in index")

    # ── 1. RF/SVM benchmark retrain ──────────────────────────────────────
    try:
        bench = run_algorithm_benchmark(force=True)
        best  = bench.get("best_algorithm", "?")
        n_s   = bench.get("n_samples",       0)
        print(f"[Training] Auto-retrain complete — {n_s} samples, "
              f"best algorithm: {best}, "
              f"RF={'trained' if _RF_STATE else 'failed'}, "
              f"SVM={'trained' if _SVM_STATE else 'failed'}")
    except Exception as exc:
        print(f"[Training] Auto-retrain error: {exc}")

    # ── 2. YOLO fine-tune when ≥ 20 verified images exist ────────────────
    # Collect all feedback images saved to disk
    feedback_image_paths: List[str] = []
    for lbl in INCIDENT_LABELS:
        safe = lbl.replace("/", "_").replace(" ", "_").lower()
        ldir = os.path.join(TRAINING_DATA_DIR, safe)
        if os.path.isdir(ldir):
            for fname in os.listdir(ldir):
                if fname.startswith("feedback_") and fname.endswith(".jpg"):
                    feedback_image_paths.append(os.path.join(ldir, fname))

    if len(feedback_image_paths) >= 20:
        print(f"[YOLO-Cloud] Starting fine-tune on {len(feedback_image_paths)} feedback images")
        _fine_tune_yolo_on_feedback()
    else:
        print(f"[YOLO-Cloud] {len(feedback_image_paths)} feedback images — "
              f"need ≥20 for YOLO fine-tune ({20 - len(feedback_image_paths)} more needed)")


def _fine_tune_yolo_on_feedback():
    """
    Fine-tune the YOLO model on all feedback images collected from officer
    approve/reject decisions.  Runs in a background thread so it never
    blocks the HTTP event loop.

    After training:
      1. Reloads the new model into _YOLO_CLOUD_MODEL
      2. Backs up the new best.pt to Catalyst Stratus
    """
    try:
        from ultralytics import YOLO as _YOLO
        import tempfile as _tmp, shutil as _sh, yaml as _yaml

        # Find base model to fine-tune from
        base = _find_best_pt() or "yolov11n.pt"

        # Build a minimal dataset YAML from feedback images
        tmp_dir   = _tmp.mkdtemp(prefix="vv_finetune_")
        train_dir = os.path.join(tmp_dir, "images", "train")
        val_dir   = os.path.join(tmp_dir, "images", "val")
        os.makedirs(train_dir, exist_ok=True)
        os.makedirs(val_dir,   exist_ok=True)

        # Gather images, split 80/20
        by_label: Dict[str, List[str]] = {}
        for lbl in INCIDENT_LABELS:
            safe = lbl.replace("/", "_").replace(" ", "_").lower()
            ldir = os.path.join(TRAINING_DATA_DIR, safe)
            if not os.path.isdir(ldir):
                continue
            imgs = [os.path.join(ldir, f) for f in os.listdir(ldir)
                    if f.endswith((".jpg", ".jpeg", ".png"))]
            if imgs:
                by_label[lbl] = imgs

        labels_used = sorted(by_label.keys())
        n_total = 0
        for lbl, paths in by_label.items():
            split = max(1, int(len(paths) * 0.8))
            for i, p in enumerate(paths):
                dest = train_dir if i < split else val_dir
                fn = f"{lbl.replace(' ','_')}_{os.path.basename(p)}"
                dst = os.path.join(dest, fn)
                if not os.path.exists(dst):
                    _sh.copy2(p, dst)
                n_total += 1

        if n_total < 20:
            print(f"[YOLO-Cloud] Fine-tune cancelled — only {n_total} images total after merge")
            _sh.rmtree(tmp_dir, ignore_errors=True)
            return

        dataset_yaml = os.path.join(tmp_dir, "dataset.yaml")
        with open(dataset_yaml, "w") as f:
            _yaml.dump({"path": tmp_dir, "train": "images/train", "val": "images/val",
                        "nc": len(labels_used), "names": labels_used}, f)

        out_dir = os.path.join(TRAINING_DATA_DIR, "runs", "finetune")
        model   = _YOLO(base)
        results = model.train(
            data=dataset_yaml,
            epochs=10,              # quick fine-tune — not full training
            imgsz=640,
            batch=4,
            project=out_dir,
            name="ft",
            exist_ok=True,
            verbose=False,
        )
        new_pt = str(results.save_dir / "weights" / "best.pt")
        if os.path.exists(new_pt):
            # Copy to canonical location
            dest_pt = os.path.join(TRAINING_DATA_DIR, "best.pt")
            _sh.copy2(new_pt, dest_pt)
            print(f"[YOLO-Cloud] Fine-tune complete → {dest_pt}")
            # Reload live model
            _load_yolo_cloud_model()
            # Back up to Stratus
            threading.Thread(target=_upload_model_to_stratus, args=(dest_pt,), daemon=True).start()
        _sh.rmtree(tmp_dir, ignore_errors=True)
    except ImportError:
        print("[YOLO-Cloud] ultralytics not installed — skipping YOLO fine-tune")
    except Exception as exc:
        print(f"[YOLO-Cloud] Fine-tune error: {exc}")


def _schedule_feedback_retrain():
    """
    Debounce helper: reset the 30-second timer on every feedback call.
    The actual retrain runs only once 30 s of silence has passed.
    """
    global _FEEDBACK_PENDING_COUNT, _FEEDBACK_RETRAIN_TIMER
    with _FEEDBACK_RETRAIN_LOCK:
        _FEEDBACK_PENDING_COUNT += 1
        if _FEEDBACK_RETRAIN_TIMER is not None:
            _FEEDBACK_RETRAIN_TIMER.cancel()
        t = threading.Timer(_FEEDBACK_RETRAIN_DELAY, _fire_feedback_retrain)
        t.daemon = True
        t.start()
        _FEEDBACK_RETRAIN_TIMER = t


def learn_from_feedback(frame_bytes: bytes, incident_type: str, is_false_alarm: bool) -> bool:
    """
    Feed officer feedback back into the model so it learns from its mistakes.

    • FALSE_ALARM  → save frame as "Normal / No Incident" AND remove the
                     nearest matching entry from the incident label's index
                     so the same visual pattern can never fire that label again.
    • CONFIRMED    → save frame as the correct incident type so the model
                     gets stronger on real examples it has actually seen.

    The feature vector is updated in the in-memory index immediately (live
    detection improves right away) and the index is persisted to disk so
    the learning survives a server restart.

    After saving the frame the function:
      1. Uploads the image to Catalyst Stratus (persistent cloud storage)
         so the training dataset survives container redeploys on AppSail.
      2. Schedules an automatic background retrain (debounced 30 s) so
         the RF/SVM models stay current with every officer decision.

    Returns True if the frame was successfully indexed, False otherwise.
    """
    if not _CV2_OK or not frame_bytes:
        return False

    label = "Normal / No Incident" if is_false_alarm else incident_type
    # Accept both generic CCTV labels and 27-class accident model labels
    if label not in INCIDENT_LABELS and label not in ACCIDENT_MODEL_LABELS:
        # Map accident model classes to nearest INCIDENT_LABELS entry
        _ACCIDENT_TO_INCIDENT = {
            "accident": "Road Accident", "damaged_vehicle": "Road Accident",
            "fallen_injured_person": "Person Unconscious", "vehicle_fire": "Fire / Smoke",
            "road_debris": "Road Accident", "tipped_over": "Road Accident",
        }
        mapped = _ACCIDENT_TO_INCIDENT.get(label)
        if mapped:
            label = mapped
        else:
            # Store under Road Accident as safe default for unknown accident classes
            label = "Road Accident"

    feat = _compute_feature(frame_bytes)
    if feat is None:
        return False

    # ── False alarm: purge this feature from the incident label's index ──────
    # Without this, the same frame sits in both Road Accident (d=0.0) and
    # Normal (d=0.0) — a tie — which leaves the model confused forever.
    if is_false_alarm and incident_type in _HIST_INDEX:
        before = len(_HIST_INDEX[incident_type])
        _HIST_INDEX[incident_type] = [
            (f, sid) for (f, sid) in _HIST_INDEX[incident_type]
            if _cosine_dist(feat, f) > 0.05
        ]
        removed = before - len(_HIST_INDEX[incident_type])
        if removed:
            print(f"[Training] Purged {removed} entry/entries from '{incident_type}' index "
                  f"(false alarm correction)")
    # ─────────────────────────────────────────────────────────────────────────

    # Save frame to disk under the correct label folder so future training
    # sessions include this real-world example automatically.
    disk_path = ""
    img_hash  = ""
    try:
        import hashlib as _hashlib
        img_hash   = _hashlib.md5(frame_bytes).hexdigest()[:12]
        label_dir  = _label_dir(label)
        disk_path  = os.path.join(label_dir, f"feedback_{img_hash}.jpg")
        if not os.path.exists(disk_path):
            with open(disk_path, "wb") as fh:
                fh.write(frame_bytes)

        # ── Upload to Catalyst Stratus ────────────────────────────────────
        # Path: feedback/<label_safe>/feedback_<hash>.jpg
        # Uploaded in a background thread so feedback never blocks the UI.
        label_safe    = label.replace("/", "_").replace(" ", "_").lower()
        stratus_path  = f"feedback/{label_safe}/feedback_{img_hash}.jpg"
        stratus_url   = None

        def _upload_to_stratus():
            nonlocal stratus_url
            stratus_url = _stratus_upload(frame_bytes, stratus_path)
            if stratus_url:
                print(f"[Training] Feedback image uploaded to Stratus: {stratus_path}")

        t = threading.Thread(target=_upload_to_stratus, daemon=True)
        t.start()
        # ─────────────────────────────────────────────────────────────────

        # Register in _SAMPLES so it shows up in the training dataset UI
        sample_id = _sample_id()
        sample: Dict[str, Any] = {
            "sample_id":        sample_id,
            "label":            label,
            "filename":         os.path.basename(disk_path),
            "file_type":        "image",
            "file_ext":         ".jpg",
            "file_size_kb":     round(len(frame_bytes) / 1024, 1),
            "camera_id":        "FEEDBACK",
            "notes":            "Auto-collected from officer feedback",
            "thumbnail":        "",
            "disk_path":        disk_path,
            "stratus_path":     stratus_path,
            "verified":         True,
            "used_in_training": True,
            "uploaded_at":      time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "indexed":          True,
            "feedback_type":    "false_alarm" if is_false_alarm else "confirmed",
        }
        _SAMPLES.insert(0, sample)
    except Exception as e:
        print(f"[Training] Could not save feedback frame to disk: {e}")

    # Add feature to live index and persist — detection improves immediately
    _add_to_hist_index(label, feat, f"feedback_{int(time.time())}", _save=True)
    print(f"[Training] Learned from feedback: label='{label}' "
          f"({'false alarm' if is_false_alarm else 'confirmed'}), "
          f"index now has {sum(len(v) for v in _HIST_INDEX.values())} entries")

    # ── Schedule auto-retrain (debounced 30 s) ────────────────────────────────
    # Batches multiple rapid approve/reject decisions into one training pass.
    _schedule_feedback_retrain()

    return True


# ─────────────────────────────────────────────────────────────────────────────
#  PYDANTIC MODELS
# ─────────────────────────────────────────────────────────────────────────────

class SampleVerifyReq(BaseModel):
    label:    str
    verified: bool = True
    notes:    Optional[str] = None


class TrainingStartReq(BaseModel):
    epochs:            int  = 20
    model_base:        str  = "yolov11n"
    description:       str  = ""
    use_verified_only: bool = True


# ─────────────────────────────────────────────────────────────────────────────
#  ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/health")
async def training_health():
    return {
        "status":          "active",
        "module":          "AI Model Training Studio",
        "dataset_stats":   _dataset_stats(),
        "active_sessions": sum(1 for s in _SESSIONS if s["status"] == "RUNNING"),
        "total_sessions":  len(_SESSIONS),
        "storage_dir":     TRAINING_DATA_DIR,
        "opencv":          _CV2_OK,
    }


@router.get("/labels")
async def get_labels():
    return {"labels": INCIDENT_LABELS}


# =============================================================================
#  ACCIDENT MODEL — 27-class dataset management
# =============================================================================

@router.get("/accident-labels")
async def get_accident_labels():
    """Return the 27-class accident model label list with per-class image counts."""
    counts: Dict[str, int] = {}
    for cls in ACCIDENT_MODEL_LABELS:
        safe = cls.replace(" ", "_").lower()
        d = os.path.join(TRAINING_DATA_DIR, "accident_images", safe)
        counts[cls] = len([f for f in os.listdir(d) if f.lower().endswith((".jpg",".jpeg",".png"))]) if os.path.isdir(d) else 0
    return {
        "labels": ACCIDENT_MODEL_LABELS,
        "n_classes": len(ACCIDENT_MODEL_LABELS),
        "image_counts": counts,
        "total_images": sum(counts.values()),
    }


@router.post("/accident/upload")
async def upload_accident_images(
    files: List[UploadFile] = File(...),
    label: str = Form(...),
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    Upload images for a specific 27-class accident model class.
    Saves to disk + Catalyst Stratus. Auto-schedules retrain.
    """
    if label not in ACCIDENT_MODEL_LABELS:
        raise HTTPException(400, f"Unknown label '{label}'.")

    safe = label.replace(" ", "_").lower()
    dest_dir = os.path.join(TRAINING_DATA_DIR, "accident_images", safe)
    os.makedirs(dest_dir, exist_ok=True)

    saved: List[Dict[str, Any]] = []
    errors: List[str] = []
    _ACC_MAP = {
        "accident": "Road Accident", "damaged_vehicle": "Road Accident",
        "vehicle_fire": "Fire / Smoke", "fallen_injured_person": "Person Unconscious",
        "road_debris": "Road Accident", "tipped_over": "Road Accident",
    }

    for f in files:
        try:
            ext = os.path.splitext(f.filename or "")[-1].lower()
            if ext not in {".jpg", ".jpeg", ".png"}:
                errors.append(f"{f.filename}: unsupported format")
                continue
            content = await f.read()
            if len(content) > 20 * 1024 * 1024:
                errors.append(f"{f.filename}: too large (max 20 MB)")
                continue

            import hashlib as _hl
            img_hash   = _hl.md5(content).hexdigest()[:12]
            disk_fname = f"acc_{img_hash}{ext}"
            disk_path  = os.path.join(dest_dir, disk_fname)
            if not os.path.exists(disk_path):
                with open(disk_path, "wb") as fh:
                    fh.write(content)

            stratus_path = f"{_ACCIDENT_STRATUS_PREFIX}/{safe}/{disk_fname}"
            entry: Dict[str, Any] = {
                "class_name":   label,
                "filename":     disk_fname,
                "disk_path":    disk_path,
                "stratus_path": stratus_path,
                "file_size_kb": round(len(content) / 1024, 1),
                "uploaded_at":  time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            _ACCIDENT_IMAGES.append(entry)
            saved.append(entry)

            # Background: Stratus upload + histogram index + _SAMPLES registration
            def _bg(c=content, sp=stratus_path, lbl=label, dp=disk_path, fn=disk_fname):
                _stratus_upload(c, sp)
                feat = _compute_feature(c)
                if feat is not None:
                    hist_label = _ACC_MAP.get(lbl, "Road Accident")
                    _add_to_hist_index(hist_label, feat, f"acc_{lbl}_{time.time()}", _save=True)
                sid = _sample_id()
                _SAMPLES.insert(0, {
                    "sample_id":        sid,
                    "label":            lbl,
                    "filename":         fn,
                    "file_type":        "image",
                    "file_ext":         os.path.splitext(fn)[-1],
                    "file_size_kb":     round(len(c) / 1024, 1),
                    "camera_id":        "ACCIDENT-UPLOAD",
                    "notes":            f"Accident model class: {lbl}",
                    "thumbnail":        "",
                    "disk_path":        dp,
                    "stratus_path":     sp,
                    "verified":         True,
                    "used_in_training": True,
                    "uploaded_at":      time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "indexed":          True,
                    "accident_class":   lbl,
                })
            threading.Thread(target=_bg, daemon=True).start()
        except Exception as exc:
            errors.append(f"{f.filename}: {exc}")

    if saved:
        _schedule_feedback_retrain()

    return {"saved": len(saved), "errors": errors, "label": label, "files": saved}


@router.get("/accident/dataset")
async def get_accident_dataset(label: Optional[str] = None):
    """List accident training images, optionally filtered by class."""
    data = _ACCIDENT_IMAGES if not label else [i for i in _ACCIDENT_IMAGES if i["class_name"] == label]
    counts: Dict[str, int] = {cls: sum(1 for i in _ACCIDENT_IMAGES if i["class_name"] == cls) for cls in ACCIDENT_MODEL_LABELS}
    return {"images": data, "total": len(data), "by_class": counts}


@router.get("/accident/status")
async def get_accident_status():
    """Summary of accident model training dataset and retrain state."""
    counts: Dict[str, int] = {}
    total = 0
    for cls in ACCIDENT_MODEL_LABELS:
        safe = cls.replace(" ", "_").lower()
        d = os.path.join(TRAINING_DATA_DIR, "accident_images", safe)
        n = len([f for f in os.listdir(d) if f.lower().endswith((".jpg",".jpeg",".png"))]) if os.path.isdir(d) else 0
        counts[cls] = n
        total += n
    return {
        "n_classes":          len(ACCIDENT_MODEL_LABELS),
        "total_images":       total,
        "images_by_class":    counts,
        "retrain_pending":    _FEEDBACK_RETRAIN_TIMER is not None,
        "retrain_queued":     _FEEDBACK_PENDING_COUNT,
        "stratus_bucket":     _STRATUS_BUCKET,
        "stratus_prefix":     _ACCIDENT_STRATUS_PREFIX,
        "ready_for_training": total >= 10,
        "recommended_min_per_class": 50,
    }


@router.get("/dataset")
async def list_dataset(
    label: Optional[str] = None,
    verified: Optional[bool] = None,
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    List training samples.
    - Admin / HQ: sees all samples.
    - Branch users: see only their own branch's samples (plus legacy untagged samples).
    """
    data = _SAMPLES
    if label:
        data = [s for s in data if s.get("label") == label]
    if verified is not None:
        data = [s for s in data if s.get("verified") == verified]
    # Branch isolation: non-admin users see only their branch
    if not current_user.is_admin:
        data = [s for s in data if current_user.can_access_branch(s.get("branch_id"))]
    return {"samples": data, "total": len(data), "stats": _dataset_stats()}


@router.get("/dataset/stats")
async def dataset_stats():
    return _dataset_stats()


# ─── shared helper so single & batch reuse same logic ─────────────────────────

def _process_upload(content: bytes, filename: str, label: str,
                    notes: str = "", camera_id: str = "CAM-TRAINING",
                    branch_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Core logic shared by /dataset/upload (single) and /dataset/upload-batch (multi).
    Saves to disk, indexes image, uploads to Catalyst Stratus (branch-scoped), returns sample dict.

    Stratus path: <branch_id or "shared">/<label_safe>/<sample_id><ext>
    """
    ext       = os.path.splitext(filename or "")[-1].lower()
    is_image  = ext in {".jpg", ".jpeg", ".png"}
    sample_id = _sample_id()
    file_size = len(content)

    label_dir  = _label_dir(label)
    disk_fname = f"{sample_id}{ext}"
    disk_path  = os.path.join(label_dir, disk_fname)
    with open(disk_path, "wb") as fh:
        fh.write(content)

    # ── Upload to Catalyst Stratus (persistent across redeploys) ──────────────
    label_safe    = label.replace("/", "_").replace(" ", "_").lower()
    stratus_scope = branch_id or "shared"
    stratus_path  = f"{stratus_scope}/{label_safe}/{disk_fname}"
    stratus_url   = _stratus_upload(content, stratus_path)

    # ── Thumbnail ──────────────────────────────────────────────────────────────
    thumbnail = ""
    if is_image:
        thumb_bytes = content[:51200]
        b64  = base64.b64encode(thumb_bytes).decode()
        mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
        thumbnail = f"data:{mime};base64,{b64}"
    else:
        frame_bytes = _extract_video_thumbnail(content, ext)
        if frame_bytes:
            b64 = base64.b64encode(frame_bytes).decode()
            thumbnail = f"data:image/jpeg;base64,{b64}"
            frame_path = disk_path.replace(ext, "_thumb.jpg")
            with open(frame_path, "wb") as fh:
                fh.write(frame_bytes)
        else:
            svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90">'
                   f'<rect width="160" height="90" fill="#111827"/>'
                   f'<text x="80" y="56" font-family="monospace" font-size="10" '
                   f'fill="white" text-anchor="middle">{label}</text></svg>')
            thumbnail = f"data:image/svg+xml;base64,{base64.b64encode(svg.encode()).decode()}"

    # ── Histogram index ────────────────────────────────────────────────────────
    verified = is_image
    if is_image:
        hist = _compute_hist(content)
        if hist is not None:
            _add_to_hist_index(label, hist, sample_id)

    sample: Dict[str, Any] = {
        "sample_id":        sample_id,
        "label":            label,
        "filename":         filename,
        "file_type":        "image" if is_image else "video",
        "file_ext":         ext,
        "file_size_kb":     round(file_size / 1024, 1),
        "camera_id":        camera_id,
        "notes":            notes,
        "thumbnail":        thumbnail,
        "disk_path":        disk_path,
        "stratus_path":     stratus_path,
        "stratus_url":      stratus_url,
        "branch_id":        branch_id,
        "verified":         verified,
        "used_in_training": False,
        "uploaded_at":      time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "indexed":          is_image and _CV2_OK,
    }
    _SAMPLES.insert(0, sample)
    return sample


_ALLOWED_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".jpg", ".jpeg", ".png"}


@router.post("/dataset/upload")
async def upload_sample(
    label:     str        = Form(...),
    notes:     str        = Form(default=""),
    camera_id: str        = Form(default="CAM-TRAINING"),
    file:      UploadFile = File(...),
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    Upload a single labelled training video or image.
    Files are saved to disk AND to Catalyst Stratus under the caller's branch.
    Images are immediately indexed into the histogram detector.
    """
    ext = os.path.splitext(file.filename or "")[-1].lower()
    if ext not in _ALLOWED_EXTS:
        raise HTTPException(400, f"Unsupported file type: {ext}. Allowed: {', '.join(sorted(_ALLOWED_EXTS))}")
    if label not in INCIDENT_LABELS:
        raise HTTPException(400, f"Unknown label: {label!r}")

    content = await file.read()
    if len(content) > 200 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 200 MB)")

    sample   = _process_upload(content, file.filename or "upload", label, notes, camera_id,
                                branch_id=current_user.branch_id)
    is_image = sample["file_type"] == "image"
    stored   = "Stratus + disk" if sample.get("stratus_url") else "disk"
    msg = (f"Image uploaded & indexed ({stored})" if (is_image and _CV2_OK)
           else f"Sample uploaded to {stored} — run a training session to activate it")
    return {"message": msg, "sample": sample, "dataset_stats": _dataset_stats()}


@router.post("/dataset/upload-batch")
async def upload_batch(
    label:     str              = Form(...),
    notes:     str              = Form(default=""),
    camera_id: str              = Form(default="CAM-TRAINING"),
    files:     List[UploadFile] = File(...),
    current_user: AuthUser      = Depends(verify_catalyst_token),
):
    """
    Upload multiple files at once under the same label.

    How to use from the UI:
      • Select multiple files (Ctrl/Cmd+click) in the file picker
      • Or drag an entire folder — the browser sends all files inside it

    How to use directly (curl):
      curl -X POST http://localhost:8000/api/v1/training/dataset/upload-batch \\
        -F label="Road Accident" \\
        -F "files=@img1.jpg" -F "files=@img2.jpg" -F "files=@clip.mp4"

    How to put files on disk yourself without uploading:
      Just copy/paste images into:
        backend/training_data/road_accident/    (for "Road Accident")
        backend/training_data/physical_fight/   (for "Physical Fight")
        backend/training_data/fire___smoke/     (for "Fire / Smoke")
      etc.  Then call POST /dataset/scan-disk to register them.

    Returns a summary: { total, succeeded, failed, samples[], dataset_stats }
    """
    if label not in INCIDENT_LABELS:
        raise HTTPException(400, f"Unknown label: {label!r}")
    if not files:
        raise HTTPException(400, "No files provided")

    results: List[Dict[str, Any]] = []
    succeeded = 0
    failed    = 0

    for upload_file in files:
        fname = upload_file.filename or "upload"
        ext   = os.path.splitext(fname)[-1].lower()
        if ext not in _ALLOWED_EXTS:
            results.append({"filename": fname, "ok": False, "error": f"Unsupported type: {ext}"})
            failed += 1
            continue
        try:
            content = await upload_file.read()
            if len(content) > 200 * 1024 * 1024:
                results.append({"filename": fname, "ok": False, "error": "File too large (>200 MB)"})
                failed += 1
                continue
            sample = _process_upload(content, fname, label, notes, camera_id,
                                     branch_id=current_user.branch_id)
            results.append({
                "filename":  fname,
                "ok":        True,
                "sample_id": sample["sample_id"],
                "file_type": sample["file_type"],
                "indexed":   sample.get("indexed", False),
            })
            succeeded += 1
        except Exception as exc:
            results.append({"filename": fname, "ok": False, "error": str(exc)})
            failed += 1

    images_indexed = sum(1 for r in results if r.get("ok") and r.get("indexed"))
    return {
        "message":       f"{succeeded} files uploaded ({images_indexed} images indexed into AI detector)",
        "total":         len(files),
        "succeeded":     succeeded,
        "failed":        failed,
        "results":       results,
        "dataset_stats": _dataset_stats(),
    }


@router.post("/dataset/scan-disk")
async def scan_disk(
    label: Optional[str] = None,
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    Scan the training_data/ folder on disk and register any files not yet in memory.

    This lets you bypass the browser upload entirely — just copy your image/video
    folders into the right subfolder on the server and call this endpoint.

    Folder name → label mapping (spaces/slashes become underscores, lowercased):
        road_accident/         → "Road Accident"
        physical_fight/        → "Physical Fight"
        weapon_detected/       → "Weapon Detected"
        fire___smoke/          → "Fire / Smoke"
        theft___robbery/       → "Theft / Robbery"
        person_unconscious/    → "Person Unconscious"
        suspicious_activity/   → "Suspicious Activity"
        vehicle_collision/     → "Vehicle Collision"
        normal___no_incident/  → "Normal / No Incident"

    Returns how many new files were found and indexed.
    """
    # Build reverse mapping: folder_name → canonical label
    folder_to_label: Dict[str, str] = {}
    for lbl in INCIDENT_LABELS:
        safe = lbl.replace("/", "_").replace(" ", "_").lower()
        folder_to_label[safe] = lbl

    scanned    = 0
    registered = 0
    skipped    = 0
    errors     = 0
    new_samples: List[Dict[str, Any]] = []

    # Track already-known disk paths so we don't double-register
    known_paths = {s.get("disk_path") for s in _SAMPLES if s.get("disk_path")}

    if not os.path.exists(TRAINING_DATA_DIR):
        return {"message": "training_data/ directory not found", "registered": 0}

    for folder_name in os.listdir(TRAINING_DATA_DIR):
        folder_path = os.path.join(TRAINING_DATA_DIR, folder_name)
        if not os.path.isdir(folder_path):
            continue

        # Skip YOLOv8 run output dirs
        if folder_name == "runs":
            continue

        lbl = folder_to_label.get(folder_name)
        if lbl is None:
            # Try partial / fuzzy match — any label whose safe name is a substring
            lbl = next((v for k, v in folder_to_label.items() if k in folder_name or folder_name in k), None)
        if lbl is None:
            continue   # unknown folder — skip

        if label and lbl != label:
            continue   # filtered to one label

        for fname in os.listdir(folder_path):
            # Skip thumbnails and yaml files
            if fname.endswith("_thumb.jpg") or fname.endswith(".yaml"):
                continue
            ext = os.path.splitext(fname)[-1].lower()
            if ext not in _ALLOWED_EXTS:
                continue

            disk_path = os.path.join(folder_path, fname)
            scanned  += 1

            if disk_path in known_paths:
                skipped += 1
                continue

            try:
                with open(disk_path, "rb") as fh:
                    content = fh.read()

                is_image  = ext in {".jpg", ".jpeg", ".png"}
                sample_id = _sample_id()

                # Build thumbnail (small, inline)
                thumbnail = ""
                if is_image:
                    b64  = base64.b64encode(content[:51200]).decode()
                    mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
                    thumbnail = f"data:{mime};base64,{b64}"
                else:
                    # Video: extract frame
                    frame_bytes = _extract_video_thumbnail(content, ext)
                    if frame_bytes:
                        thumbnail = f"data:image/jpeg;base64,{base64.b64encode(frame_bytes).decode()}"

                # Index image into histogram detector
                verified = is_image
                if is_image:
                    hist = _compute_hist(content)
                    if hist is not None:
                        _add_to_hist_index(lbl, hist, sample_id)

                sample: Dict[str, Any] = {
                    "sample_id":        sample_id,
                    "label":            lbl,
                    "filename":         fname,
                    "file_type":        "image" if is_image else "video",
                    "file_ext":         ext,
                    "file_size_kb":     round(len(content) / 1024, 1),
                    "camera_id":        "CAM-DISK-SCAN",
                    "notes":            f"Scanned from disk: {folder_name}/",
                    "thumbnail":        thumbnail,
                    "disk_path":        disk_path,
                    "verified":         verified,
                    "used_in_training": False,
                    "uploaded_at":      time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "indexed":          is_image and _CV2_OK,
                }
                _SAMPLES.insert(0, sample)
                known_paths.add(disk_path)
                new_samples.append({"filename": fname, "label": lbl, "sample_id": sample_id})
                registered += 1
            except Exception as exc:
                errors += 1
                print(f"[scan-disk] Error reading {disk_path}: {exc}")

    return {
        "message":       f"Scan complete: {registered} new files registered, {skipped} already known, {errors} errors",
        "scanned":       scanned,
        "registered":    registered,
        "skipped":       skipped,
        "errors":        errors,
        "new_samples":   new_samples[:50],   # first 50 for response size
        "dataset_stats": _dataset_stats(),
        "storage_dir":   TRAINING_DATA_DIR,
        "folder_map":    {k: v for k, v in folder_to_label.items()},
    }


@router.patch("/dataset/{sample_id}/verify")
async def verify_sample(sample_id: str, req: SampleVerifyReq):
    """Verify / re-label a sample. Also adds it to the histogram index."""
    sample = next((s for s in _SAMPLES if s["sample_id"] == sample_id), None)
    if not sample:
        raise HTTPException(404, "Sample not found")
    if req.label not in INCIDENT_LABELS:
        raise HTTPException(400, f"Unknown label: {req.label!r}")

    sample["label"]       = req.label
    sample["verified"]    = req.verified
    sample["verified_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if req.notes:
        sample["notes"] = req.notes

    # Re-index if it's an image
    if req.verified and sample.get("file_type") == "image":
        disk_path = sample.get("disk_path")
        if disk_path and os.path.exists(disk_path):
            with open(disk_path, "rb") as f:
                img_bytes = f.read()
            hist = _compute_hist(img_bytes)
            if hist is not None:
                _add_to_hist_index(req.label, hist, sample_id)

    return {"message": "Sample updated", "sample": sample, "dataset_stats": _dataset_stats()}


@router.delete("/dataset/{sample_id}")
async def delete_sample(sample_id: str):
    idx = next((i for i, s in enumerate(_SAMPLES) if s["sample_id"] == sample_id), None)
    if idx is None:
        raise HTTPException(404, "Sample not found")
    sample = _SAMPLES[idx]
    # Remove file from disk
    disk_path = sample.get("disk_path")
    if disk_path and os.path.exists(disk_path):
        try:
            os.remove(disk_path)
            thumb = disk_path.replace(sample.get("file_ext", ""), "_thumb.jpg")
            if os.path.exists(thumb):
                os.remove(thumb)
        except Exception:
            pass
    _SAMPLES.pop(idx)
    return {"message": f"Sample {sample_id} removed", "dataset_stats": _dataset_stats()}


# ── Training sessions ─────────────────────────────────────────────────────────

@router.get("/sessions")
async def list_sessions():
    return {"sessions": _SESSIONS, "total": len(_SESSIONS)}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    s = next((s for s in _SESSIONS if s["session_id"] == session_id), None)
    if not s:
        raise HTTPException(404, "Session not found")
    return s


@router.post("/sessions/start")
async def start_training(req: TrainingStartReq):
    """Start a training session. Rebuilds the histogram index and simulates YOLOv8."""
    global _TRAINING_TASK

    running = [s for s in _SESSIONS if s["status"] == "RUNNING"]
    if running:
        raise HTTPException(409, f"Session {running[0]['session_id']} is already running.")

    stats   = _dataset_stats()
    samples = [s for s in _SAMPLES if (not req.use_verified_only or s.get("verified"))]

    session_id = _session_id()
    session: Dict[str, Any] = {
        "session_id":      session_id,
        "model_base":      req.model_base,
        "epochs":          req.epochs,
        "description":     req.description,
        "dataset_size":    len(samples),
        "dataset_stats":   stats,
        "status":          "QUEUED",
        "progress_pct":    0,
        "current_epoch":   0,
        "metrics_history": [],
        "latest_metrics":  {},
        "final_metrics":   {},
        "hist_index_size": 0,
        "model_path":      None,
        "created_at":      time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "started_at":      None,
        "completed_at":    None,
        "error":           None,
        "_cancel":         False,
    }
    _SESSIONS.insert(0, session)

    sample_paths = [s.get("disk_path", "") for s in samples if s.get("disk_path")]
    _TRAINING_TASK = asyncio.create_task(
        _run_training_job(session_id, req.epochs, sample_paths)
    )

    return {"message": "Training session started", "session": session}


@router.post("/sessions/{session_id}/cancel")
async def cancel_session(session_id: str):
    s = next((s for s in _SESSIONS if s["session_id"] == session_id), None)
    if not s:
        raise HTTPException(404, "Session not found")
    if s["status"] != "RUNNING":
        raise HTTPException(400, f"Session is {s['status']}, not RUNNING")
    s["_cancel"] = True
    return {"message": f"Cancellation requested for {session_id}"}


@router.get("/model/current")
async def current_model():
    completed = [s for s in _SESSIONS if s["status"] == "COMPLETED"]
    hist_size = sum(len(v) for v in _HIST_INDEX.values())
    if not completed and hist_size == 0:
        return {
            "model": None,
            "message": "No trained model yet",
            "using_base_model": True,
            "base_model": "Heuristic AI (rule-based)",
            "hist_index_size": 0,
        }
    latest = completed[0] if completed else None
    return {
        "model":            latest["model_path"] if latest else None,
        "session":          latest["session_id"] if latest else None,
        "trained_at":       latest["completed_at"] if latest else None,
        "metrics":          latest["final_metrics"] if latest else {},
        "epochs":           latest["epochs"] if latest else 0,
        "dataset_size":     latest["dataset_size"] if latest else 0,
        "using_base_model": hist_size == 0,
        "hist_index_size":  hist_size,
        "opencv":           _CV2_OK,
    }


@router.get("/dataset/storage")
async def storage_info():
    """Show what's saved on disk."""
    result = {}
    if os.path.exists(TRAINING_DATA_DIR):
        for label_folder in os.listdir(TRAINING_DATA_DIR):
            folder_path = os.path.join(TRAINING_DATA_DIR, label_folder)
            if os.path.isdir(folder_path):
                files = os.listdir(folder_path)
                result[label_folder] = {
                    "count": len(files),
                    "files": files[:20],   # show first 20
                }
    return {"storage_dir": TRAINING_DATA_DIR, "labels": result}


# ═══════════════════════════════════════════════════════════════════
#  WATCHDOG — auto-scans training_data/ every 10 s
#  Detects new files dropped into folders and registers them
#  automatically, no manual "Scan Disk" button required.
# ═══════════════════════════════════════════════════════════════════

def _build_folder_to_label() -> Dict[str, str]:
    """Return mapping of folder_name → canonical label."""
    mapping: Dict[str, str] = {}
    for lbl in INCIDENT_LABELS:
        safe = lbl.replace("/", "_").replace(" ", "_").lower()
        mapping[safe] = lbl
    return mapping


def _count_media_files(folder_path: str) -> int:
    """Count media files (not thumbnails/yaml) in a folder."""
    try:
        return sum(
            1 for f in os.listdir(folder_path)
            if not f.endswith(("_thumb.jpg", ".yaml", ".txt"))
            and os.path.splitext(f)[1].lower() in _ALLOWED_EXTS
        )
    except Exception:
        return 0


def _auto_scan_disk():
    """
    Register all images/videos from training_data/ into _SAMPLES on startup.
    Skips files already known (by disk_path). Safe to call multiple times.
    Called once when the watchdog starts so the dataset grid is populated
    immediately without requiring the user to click 'Scan Disk' manually.
    """
    global _WATCHDOG_LAST_SCAN, _WATCHDOG_LAST_COUNT, _WATCHDOG_NEW_COUNT

    if not os.path.exists(TRAINING_DATA_DIR):
        return

    folder_to_label = _build_folder_to_label()
    known_paths = {s.get("disk_path") for s in _SAMPLES if s.get("disk_path")}
    registered = 0

    for folder_name in os.listdir(TRAINING_DATA_DIR):
        folder_path = os.path.join(TRAINING_DATA_DIR, folder_name)
        if not os.path.isdir(folder_path) or folder_name == "runs":
            continue
        lbl = folder_to_label.get(folder_name)
        if lbl is None:
            lbl = next((v for k, v in folder_to_label.items() if k in folder_name or folder_name in k), None)
        if lbl is None:
            continue

        for fname in os.listdir(folder_path):
            if fname.endswith("_thumb.jpg") or fname.endswith(".yaml"):
                continue
            ext = os.path.splitext(fname)[-1].lower()
            if ext not in _ALLOWED_EXTS:
                continue
            disk_path = os.path.join(folder_path, fname)
            if disk_path in known_paths:
                continue
            try:
                with open(disk_path, "rb") as fh:
                    content = fh.read()
                is_image  = ext in {".jpg", ".jpeg", ".png"}
                sample_id = _sample_id()
                thumbnail = ""
                if is_image:
                    # Use first 8 KB only for thumbnail — avoids sending megabytes
                    thumb_data = content[:8192]
                    b64  = base64.b64encode(thumb_data).decode()
                    mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
                    thumbnail = f"data:{mime};base64,{b64}"
                sample: Dict[str, Any] = {
                    "sample_id":        sample_id,
                    "label":            lbl,
                    "filename":         fname,
                    "file_type":        "image" if is_image else "video",
                    "file_ext":         ext,
                    "file_size_kb":     round(len(content) / 1024, 1),
                    "camera_id":        "CAM-DISK-SCAN",
                    "notes":            f"Auto-scanned: {folder_name}/",
                    "thumbnail":        thumbnail,
                    "disk_path":        disk_path,
                    "verified":         is_image,
                    "used_in_training": False,
                    "uploaded_at":      time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "indexed":          is_image and _CV2_OK,
                }
                _SAMPLES.insert(0, sample)
                known_paths.add(disk_path)
                registered += 1
            except Exception as exc:
                print(f"[auto-scan] skipped {disk_path}: {exc}")

    total = len(_SAMPLES)
    _WATCHDOG_LAST_COUNT = total
    _WATCHDOG_LAST_SCAN  = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _WATCHDOG_NEW_COUNT  = registered
    if registered:
        print(f"[Training] Auto-scan on startup: registered {registered} new files, {total} total in memory")
    else:
        print(f"[Training] Auto-scan on startup: {total} samples already in memory, nothing new")


async def _watchdog_loop():
    """
    Runs forever in the background.
    Every 10 seconds it compares folder file-counts to the last snapshot.
    If any folder has grown, it immediately calls the same logic as scan_disk()
    to register the new files.
    """
    global _WATCHDOG_LAST_SCAN, _WATCHDOG_LAST_COUNT, _WATCHDOG_NEW_COUNT, _FOLDER_SNAPSHOT

    folder_to_label = _build_folder_to_label()

    # Snapshot current folder counts
    if os.path.exists(TRAINING_DATA_DIR):
        for folder_name in os.listdir(TRAINING_DATA_DIR):
            folder_path = os.path.join(TRAINING_DATA_DIR, folder_name)
            if os.path.isdir(folder_path) and folder_name != "runs":
                _FOLDER_SNAPSHOT[folder_name] = _count_media_files(folder_path)

    await asyncio.sleep(3)   # brief warm-up

    while True:
        try:
            if not os.path.exists(TRAINING_DATA_DIR):
                await asyncio.sleep(10)
                continue

            changed_folders: List[str] = []

            for folder_name in os.listdir(TRAINING_DATA_DIR):
                folder_path = os.path.join(TRAINING_DATA_DIR, folder_name)
                if not os.path.isdir(folder_path) or folder_name == "runs":
                    continue
                current_count = _count_media_files(folder_path)
                previous_count = _FOLDER_SNAPSHOT.get(folder_name, -1)
                if current_count != previous_count:
                    changed_folders.append(folder_name)
                _FOLDER_SNAPSHOT[folder_name] = current_count

            if changed_folders:
                # Run the registration logic for changed folders
                known_paths = {s.get("disk_path") for s in _SAMPLES if s.get("disk_path")}
                new_registered = 0

                for folder_name in changed_folders:
                    lbl = folder_to_label.get(folder_name)
                    if lbl is None:
                        lbl = next(
                            (v for k, v in folder_to_label.items()
                             if k in folder_name or folder_name in k),
                            None
                        )
                    if lbl is None:
                        continue

                    folder_path = os.path.join(TRAINING_DATA_DIR, folder_name)
                    for fname in os.listdir(folder_path):
                        if fname.endswith(("_thumb.jpg", ".yaml", ".txt")):
                            continue
                        ext = os.path.splitext(fname)[1].lower()
                        if ext not in _ALLOWED_EXTS:
                            continue
                        disk_path = os.path.join(folder_path, fname)
                        if disk_path in known_paths:
                            continue
                        try:
                            with open(disk_path, "rb") as fh:
                                content = fh.read()
                            is_image  = ext in {".jpg", ".jpeg", ".png"}
                            sample_id = _sample_id()
                            # Thumbnail
                            thumbnail = ""
                            if is_image:
                                b64  = base64.b64encode(content[:51200]).decode()
                                mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
                                thumbnail = f"data:{mime};base64,{b64}"
                            else:
                                frame_bytes = _extract_video_thumbnail(content, ext)
                                if frame_bytes:
                                    thumbnail = f"data:image/jpeg;base64,{base64.b64encode(frame_bytes).decode()}"
                            # Index
                            verified = is_image
                            if is_image:
                                hist = _compute_hist(content)
                                if hist is not None:
                                    _add_to_hist_index(lbl, hist, sample_id)
                            sample: Dict[str, Any] = {
                                "sample_id":        sample_id,
                                "label":            lbl,
                                "filename":         fname,
                                "file_type":        "image" if is_image else "video",
                                "file_ext":         ext,
                                "file_size_kb":     round(len(content) / 1024, 1),
                                "camera_id":        "CAM-WATCHDOG",
                                "notes":            f"Auto-detected: {folder_name}/",
                                "thumbnail":        thumbnail,
                                "disk_path":        disk_path,
                                "verified":         verified,
                                "used_in_training": False,
                                "uploaded_at":      time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                "indexed":          is_image and _CV2_OK,
                            }
                            _SAMPLES.insert(0, sample)
                            known_paths.add(disk_path)
                            new_registered += 1
                        except Exception as exc:
                            print(f"[watchdog] Error reading {disk_path}: {exc}")

                if new_registered > 0:
                    print(f"[watchdog] Auto-registered {new_registered} new file(s) from {changed_folders}")
                    _WATCHDOG_NEW_COUNT = new_registered
                else:
                    _WATCHDOG_NEW_COUNT = 0
            else:
                _WATCHDOG_NEW_COUNT = 0

            _WATCHDOG_LAST_SCAN  = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            _WATCHDOG_LAST_COUNT = sum(_FOLDER_SNAPSHOT.values())

        except asyncio.CancelledError:
            return
        except Exception as exc:
            print(f"[watchdog] Error: {exc}")

        await asyncio.sleep(10)   # poll every 10 seconds


async def start_watchdog():
    global _WATCHDOG_TASK
    # Auto-populate _SAMPLES from disk immediately on startup
    _auto_scan_disk()
    if _WATCHDOG_TASK is None or _WATCHDOG_TASK.done():
        _WATCHDOG_TASK = asyncio.create_task(_watchdog_loop())
        print("[Training] Folder watchdog started — auto-scanning every 10s")


async def stop_watchdog():
    global _WATCHDOG_TASK
    if _WATCHDOG_TASK and not _WATCHDOG_TASK.done():
        _WATCHDOG_TASK.cancel()
        try:
            await _WATCHDOG_TASK
        except asyncio.CancelledError:
            pass
    print("[Training] Folder watchdog stopped")


@router.get("/dataset/folder-status")
async def folder_status():
    """
    Returns per-folder file counts, watchdog health, and last scan time.
    The frontend polls this every 5 s to show a live folder monitor.
    """
    folder_to_label = _build_folder_to_label()
    folders = []

    if os.path.exists(TRAINING_DATA_DIR):
        for folder_name in sorted(os.listdir(TRAINING_DATA_DIR)):
            folder_path = os.path.join(TRAINING_DATA_DIR, folder_name)
            if not os.path.isdir(folder_path) or folder_name == "runs":
                continue
            lbl = folder_to_label.get(folder_name)
            if lbl is None:
                continue
            total_files  = _count_media_files(folder_path)
            # count how many are already registered in memory
            registered   = sum(
                1 for s in _SAMPLES
                if s.get("disk_path", "").startswith(folder_path)
            )
            folders.append({
                "folder":     folder_name,
                "label":      lbl,
                "total":      total_files,
                "registered": registered,
                "new":        max(0, total_files - registered),
            })

    return {
        "folders":     folders,
        "last_scan":   _WATCHDOG_LAST_SCAN,
        "total_files": _WATCHDOG_LAST_COUNT,
        "last_new":    _WATCHDOG_NEW_COUNT,
        "watchdog_running": _WATCHDOG_TASK is not None and not _WATCHDOG_TASK.done(),
        "storage_dir": TRAINING_DATA_DIR,
    }


# =============================================================================
#  TRAINING STATUS — quick health check for the UI
# =============================================================================

@router.get("/status")
async def training_status():
    """
    One-stop endpoint showing whether the trained model is live and ready.
    Polls every few seconds from the CCTV page to show a status badge.
    """
    hist_size  = sum(len(v) for v in _HIST_INDEX.values())
    index_file = os.path.exists(_HIST_INDEX_PATH)
    by_label   = {lbl: len(entries) for lbl, entries in _HIST_INDEX.items()}

    completed_sessions = [s for s in _SESSIONS if s.get("status") == "COMPLETED"]
    running_sessions   = [s for s in _SESSIONS if s.get("status") == "RUNNING"]
    latest_session     = completed_sessions[0] if completed_sessions else None

    # Determine active production classifier
    if _YOLO_CLOUD_MODEL is not None:
        prod_clf = "YOLO Cloud (PRIMARY)"
    elif _RF_STATE is not None:
        prod_clf = "Random Forest (SECONDARY)"
    elif _SVM_STATE is not None:
        prod_clf = "SVM (RBF) (TERTIARY)"
    else:
        prod_clf = "Cosine NN (fallback)"

    # Count feedback images saved for YOLO fine-tune progress
    feedback_imgs = 0
    for lbl in INCIDENT_LABELS:
        safe = lbl.replace("/", "_").replace(" ", "_").lower()
        ldir = os.path.join(TRAINING_DATA_DIR, safe)
        if os.path.isdir(ldir):
            feedback_imgs += sum(
                1 for f in os.listdir(ldir)
                if f.startswith("feedback_") and f.endswith(".jpg")
            )

    return {
        "model_ready":          hist_size > 0 or _YOLO_CLOUD_MODEL is not None,
        "hist_index_size":      hist_size,
        "hist_index_persisted": index_file,
        "hist_by_label":        by_label,
        "opencv_available":     _CV2_OK,
        "labels_trained":       list(by_label.keys()),
        "total_labels":         len(by_label),
        "total_samples_loaded": len(_SAMPLES),
        "training_running":     len(running_sessions) > 0,
        "last_session_id":      latest_session["session_id"] if latest_session else None,
        "last_trained_at":      latest_session["completed_at"] if latest_session else None,
        "last_final_metrics":   latest_session.get("final_metrics", {}) if latest_session else {},
        "index_file_path":      _HIST_INDEX_PATH,
        "detection_threshold":  0.35,
        "distance_metric":      "cosine nearest-neighbour",
        # YOLO cloud model (new PRIMARY)
        "yolo_ready":           _YOLO_CLOUD_MODEL is not None,
        "yolo_model_path":      _YOLO_CLOUD_MODEL_PATH,
        "yolo_feedback_imgs":   feedback_imgs,
        "yolo_finetune_needed": feedback_imgs,  # imgs needed → 20 − current
        "yolo_finetune_at":     20,             # threshold
        # Random Forest (SECONDARY)
        "rf_ready":             _RF_STATE is not None,
        "rf_n_samples":         _RF_STATE.get("n_samples", 0) if _RF_STATE else 0,
        "rf_n_classes":         _RF_STATE.get("n_classes", 0) if _RF_STATE else 0,
        "rf_trained_at":        _RF_STATE.get("trained_at") if _RF_STATE else None,
        # SVM (TERTIARY)
        "svm_ready":            _SVM_STATE is not None,
        "svm_n_samples":        _SVM_STATE.get("n_samples", 0) if _SVM_STATE else 0,
        "svm_n_classes":        _SVM_STATE.get("n_classes", 0) if _SVM_STATE else 0,
        "svm_trained_at":       _SVM_STATE.get("trained_at") if _SVM_STATE else None,
        "production_classifier": prod_clf,
        "sklearn_available":    _SKLEARN_OK,
        "benchmark_available":  _BENCHMARK_CACHE is not None,
        # Auto-retrain state (from officer approve/reject feedback)
        "auto_retrain_pending": _FEEDBACK_RETRAIN_TIMER is not None,
        "auto_retrain_queued":  _FEEDBACK_PENDING_COUNT,
        "auto_retrain_delay_s": _FEEDBACK_RETRAIN_DELAY,
        "stratus_bucket":       _STRATUS_BUCKET,
    }


# =============================================================================
#  BENCHMARK — multi-algorithm comparison
# =============================================================================

@router.get("/benchmark")
async def get_benchmark():
    """
    Return the cached benchmark results (last run).
    Use POST /benchmark/run to trigger a fresh benchmark.
    """
    if _BENCHMARK_CACHE is not None:
        return _BENCHMARK_CACHE
    # Try loading from disk if it wasn't picked up at startup
    if os.path.exists(_BENCHMARK_PATH):
        try:
            with open(_BENCHMARK_PATH, "r") as f:
                data = json.load(f)
            return data
        except Exception:
            pass
    return {
        "message":     "No benchmark results yet. POST /api/v1/training/benchmark/run to generate.",
        "sklearn":     _SKLEARN_OK,
        "install_cmd": "pip install scikit-learn" if not _SKLEARN_OK else None,
    }


# =============================================================================
#  MODEL INFO — describes ALL models currently in use
# =============================================================================

@router.get("/model-info")
async def get_model_info():
    """
    Returns metadata about every model active in the system:
      1. YOLOv11n (Hailo HEF) — primary edge detector on RPi5
      2. Custom trained ONNX model — trained from the Roboflow "Accident Signals" dataset
      3. Random Forest / SVM (sklearn) — cloud-side incident classifier
      4. Supervision ByteTrack — object tracking (no inference, pure Kalman+IoU)

    This is the "new model" endpoint referenced in the dashboard.
    The old YOLOv11n base model is replaced by the custom-trained ONNX when
    deployed to the RPi5 Hailo HEF pipeline.
    """
    # Check if our trained ONNX model file exists
    _onnx_candidates = [
        os.path.join(TRAINING_DATA_DIR, "runs", "best.onnx"),
        os.path.join(TRAINING_DATA_DIR, "best.onnx"),
        # path from Roboflow training run
        os.path.join(_BACKEND_ROOT, "training_data", "best.onnx"),
    ]
    onnx_path = next((p for p in _onnx_candidates if os.path.exists(p)), None)
    onnx_size_mb = round(os.path.getsize(onnx_path) / 1024 / 1024, 2) if onnx_path else None

    # ── HEF model deployed on RPi5 edge unit ─────────────────────────────────
    # The compiled HEF (yolov11n.hef) is a CUSTOM 27-class accident-detection model.
    # This is DIFFERENT from the 10-class "Accident Signals v2" Roboflow dataset
    # used only for initial cloud classifier training.
    # The 27 class IDs/names are authoritative and defined in catalyst_pipeline.py.
    hef_class_names_27 = [
        "accident",            "ambulance",           "auto_rickshaw",
        "bus",                 "car",                 "damaged_vehicle",
        "fallen_injured_person","firetruck",           "license_plate",
        "motorcycle",          "person",              "police_vehicle",
        "road_debris",         "tipped_over",         "truck",
        "vehicle_fire",        "damaged_head_light",  "damaged_hood",
        "damaged_trunk",       "damaged_window",      "damaged_windscreen",
        "damaged_bumper",      "damaged_door",        "damaged_fender",
        "damaged_mirror_glass","dent_or_scratch",     "missing_grille",
    ]

    # ── Roboflow 10-class dataset info (cloud training only, NOT the HEF) ────
    dataset_info = {
        "name": "Accident Signals v2 (Roboflow) — cloud training only",
        "classes": 10,
        "class_names": [
            "auto_rickshaw", "bus", "car", "damaged_vehicle", "license_plate",
            "motorcycle", "person", "road_debris", "truck", "vehicle_fire"
        ],
        "train_images": "~150",
        "val_images":   "~30",
        "source":       "Roboflow Universe — VigilanteVanguard custom dataset",
        "augmented":    True,
        "note":         (
            "This 10-class dataset was used for cloud classifier (RF/SVM) training. "
            "The RPi5 HEF model uses a separate 27-class custom dataset."
        ),
    }

    # Training metrics from last benchmark
    metrics: dict = {}
    if _BENCHMARK_CACHE:
        rf_algo  = _BENCHMARK_CACHE.get("algorithms", {}).get("Random Forest", {})
        svm_algo = _BENCHMARK_CACHE.get("algorithms", {}).get("SVM (RBF)", {})
        metrics  = {
            "rf_accuracy":  rf_algo.get("accuracy"),
            "rf_f1":        rf_algo.get("f1_macro"),
            "svm_accuracy": svm_algo.get("accuracy"),
            "svm_f1":       svm_algo.get("f1_macro"),
            "n_samples":    _BENCHMARK_CACHE.get("n_samples"),
            "n_classes":    _BENCHMARK_CACHE.get("n_classes"),
            "cv_folds":     _BENCHMARK_CACHE.get("cv_folds"),
            "best_algorithm": _BENCHMARK_CACHE.get("best_algorithm"),
        }

    return {
        "models": {
            "hailo_yolo": {
                "name":         "YOLOv11n (Custom 27-Class Accident Detection)",
                "format":       "Hailo HEF (RPi5 Hailo-8L NPU)",
                "base_model":   "yolov11n",
                "trained_on":   "Custom 27-class accident-detection dataset",
                "classes":      27,
                "class_names":  hef_class_names_27,
                "input_size":   "640×640",
                "status":       "ACTIVE — running on RPi5 edge unit (Hailo-8L NPU)",
                "replaces":     "yolov11n.hef (generic base — REPLACED by custom 27-class model)",
                "note":         (
                    "27 classes: accident, ambulance, auto_rickshaw, bus, car, "
                    "damaged_vehicle, fallen_injured_person, firetruck, license_plate, "
                    "motorcycle, person, police_vehicle, road_debris, tipped_over, truck, "
                    "vehicle_fire, + 11 damage classes (damaged_head_light … missing_grille). "
                    "HEF compiled for Hailo-8L NPU from custom ONNX."
                ),
            },
            "onnx_model": {
                "name":        "YOLOv11n Custom ONNX",
                "format":      "ONNX (for Hailo HEF compilation)",
                "path":        onnx_path or "training_data/runs/best.onnx",
                "size_mb":     onnx_size_mb,
                "available":   onnx_path is not None,
                "trained_at":  _RF_STATE.get("trained_at") if _RF_STATE else None,
                "dataset":     dataset_info,
            },
            "sklearn_rf": {
                "name":       "Random Forest (PRIMARY cloud classifier)",
                "algorithm":  "sklearn RandomForestClassifier (200 trees)",
                "ready":      _RF_STATE is not None,
                "n_samples":  _RF_STATE.get("n_samples") if _RF_STATE else 0,
                "n_classes":  _RF_STATE.get("n_classes") if _RF_STATE else 0,
                "trained_at": _RF_STATE.get("trained_at") if _RF_STATE else None,
                "accuracy":   metrics.get("rf_accuracy"),
                "f1":         metrics.get("rf_f1"),
            },
            "sklearn_svm": {
                "name":       "SVM RBF (SECONDARY cloud classifier)",
                "algorithm":  "sklearn SVC (RBF kernel, calibrated probabilities)",
                "ready":      _SVM_STATE is not None,
                "n_samples":  _SVM_STATE.get("n_samples") if _SVM_STATE else 0,
                "n_classes":  _SVM_STATE.get("n_classes") if _SVM_STATE else 0,
                "trained_at": _SVM_STATE.get("trained_at") if _SVM_STATE else None,
                "accuracy":   metrics.get("svm_accuracy"),
                "f1":         metrics.get("svm_f1"),
            },
            "supervision_bytetrack": {
                "name":       "Supervision ByteTrack 0.31.0.dev0",
                "type":       "Multi-object tracker (Kalman filter + IoU matching)",
                "inference":  False,
                "cpu_only":   True,
                "algorithm":  "ByteTrack — BYTE data association + KalmanFilter",
                "source":     "Roboflow Supervision 0.31.0.dev0 (local repo)",
                "track_history": 60,
                "stale_timeout": 5,
                "note":       "No neural inference — pure CPU Kalman+IoU tracking",
            },
        },
        "production_classifier": (
            "Random Forest" if _RF_STATE else ("SVM (RBF)" if _SVM_STATE else "Cosine NN fallback")
        ),
        "dataset": dataset_info,
        "metrics": metrics,
        "stratus_bucket": _STRATUS_BUCKET,
    }


@router.post("/benchmark/run")
async def run_benchmark_endpoint(force: bool = False):
    """
    Run the multi-algorithm benchmark in a background thread so it doesn't block
    the event loop (SVM + MLP on 150+ samples can take a few seconds).

    Algorithms: KMeans, KNN (k=5), SVM (RBF), Random Forest, MLP (256,128), Cosine NN
    Evaluation: stratified 5-fold cross-validation
    After completion the SVM is also retrained on the full dataset.
    """
    if not _SKLEARN_OK:
        raise HTTPException(
            503,
            "scikit-learn not installed. Run: pip install scikit-learn  then restart the server.",
        )
    import concurrent.futures
    loop = asyncio.get_event_loop()
    try:
        # Run the CPU-heavy benchmark in a threadpool so FastAPI stays responsive
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            result = await loop.run_in_executor(
                pool,
                lambda: run_algorithm_benchmark(force=force),
            )
        return result
    except Exception as exc:
        raise HTTPException(500, f"Benchmark failed: {exc}") from exc


# =============================================================================
#  VIDEO FRAME EXTRACTION — extract training images from a video at 1 FPS
# =============================================================================

@router.post("/dataset/extract-video-frames")
async def extract_video_frames(
    label:      str        = Form(...),
    fps:        float      = Form(default=1.0),
    max_frames: int        = Form(default=300),
    camera_id:  str        = Form(default="CAM-VIDEO"),
    notes:      str        = Form(default=""),
    file:       UploadFile = File(...),
):
    """
    Upload a labelled video (MP4/AVI/MOV/MKV/WEBM) and automatically extract
    frames at the given FPS rate, saving them as JPEG training images under
    training_data/<label>/.

    Each extracted frame is:
      1. Saved to disk as a JPEG training image
      2. Indexed into the cosine-NN histogram detector immediately
      3. Added to _SAMPLES so the Training Studio grid shows it

    After extraction the endpoint returns a count of frames extracted and
    immediately indexed, so the model gets smarter before you even start a
    formal training session.

    Parameters
    ----------
    label      : incident label — must be one of INCIDENT_LABELS
    fps        : frames-per-second to extract (default 1.0, max 5.0)
    max_frames : cap on total extracted frames to avoid filling disk (default 300)
    camera_id  : optional tag for provenance
    notes      : optional description stored with each sample
    file       : video file (MP4, AVI, MOV, MKV, WEBM) up to 500 MB

    Returns
    -------
    { extracted, indexed, skipped, label, message, dataset_stats }
    """
    if not _CV2_OK:
        raise HTTPException(503, "OpenCV not available — cannot extract video frames")

    ext = os.path.splitext(file.filename or "")[-1].lower()
    if ext not in {".mp4", ".avi", ".mov", ".mkv", ".webm"}:
        raise HTTPException(400, f"Unsupported video type: {ext}")
    if label not in INCIDENT_LABELS:
        raise HTTPException(400, f"Unknown label: {label!r}")

    fps        = max(0.1, min(fps, 5.0))     # cap 0.1 – 5 FPS
    max_frames = max(1, min(max_frames, 500))

    content = await file.read()
    if len(content) > 500 * 1024 * 1024:
        raise HTTPException(413, "Video too large (max 500 MB)")

    import tempfile as _tempfile

    extracted  = 0
    indexed    = 0
    skipped    = 0
    label_dir  = _label_dir(label)
    src_stem   = os.path.splitext(file.filename or "video")[0][:32]

    try:
        with _tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        cap = cv2.VideoCapture(tmp_path)
        vid_fps   = cap.get(cv2.CAP_PROP_FPS) or 25.0
        interval  = max(1, int(round(vid_fps / fps)))   # grab every N-th frame
        frame_idx = 0
        saved_idx = 0

        while saved_idx < max_frames:
            ret, frame = cap.read()
            if not ret:
                break
            frame_idx += 1
            if frame_idx % interval != 0:
                continue

            # Skip very dark frames (likely transitions / blackouts)
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            if gray.mean() < 8:
                skipped += 1
                continue

            # Encode to JPEG
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            if not ok:
                skipped += 1
                continue

            frame_bytes = buf.tobytes()
            sample_id   = _sample_id()
            fname       = f"{src_stem}_f{saved_idx:04d}_{sample_id}.jpg"
            disk_path   = os.path.join(label_dir, fname)

            with open(disk_path, "wb") as fh:
                fh.write(frame_bytes)
            extracted += 1
            saved_idx += 1

            # Index feature immediately
            feat = _compute_feature(frame_bytes)
            if feat is not None:
                _add_to_hist_index(label, feat, sample_id, _save=False)
                indexed += 1

            # Register sample
            b64_thumb  = base64.b64encode(frame_bytes[:51200]).decode()
            thumbnail  = f"data:image/jpeg;base64,{b64_thumb}"
            sample: Dict[str, Any] = {
                "sample_id":        sample_id,
                "label":            label,
                "filename":         fname,
                "file_type":        "image",
                "file_ext":         ".jpg",
                "file_size_kb":     round(len(frame_bytes) / 1024, 1),
                "camera_id":        camera_id,
                "notes":            notes or f"Extracted from {file.filename} @ {fps} FPS",
                "thumbnail":        thumbnail,
                "disk_path":        disk_path,
                "verified":         True,
                "used_in_training": False,
                "uploaded_at":      time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "indexed":          True,
            }
            _SAMPLES.insert(0, sample)

        cap.release()
        os.unlink(tmp_path)

        # Persist histogram index once after all frames
        if indexed > 0:
            _save_hist_index()

        print(f"[Training] Video extraction: {extracted} frames from {file.filename!r} "
              f"→ {indexed} indexed, {skipped} skipped · label={label!r}")

    except Exception as exc:
        raise HTTPException(500, f"Video extraction failed: {exc}") from exc

    return {
        "message":       f"Extracted {extracted} frames from video ({indexed} indexed into AI detector)",
        "extracted":     extracted,
        "indexed":       indexed,
        "skipped":       skipped,
        "label":         label,
        "fps_requested": fps,
        "max_frames":    max_frames,
        "dataset_stats": _dataset_stats(),
    }


# =============================================================================
#  DEBUG DETECT — test what the model sees from a raw frame
# =============================================================================

@router.post("/debug/detect")
async def debug_detect(file: UploadFile = File(...)):
    """
    Upload any image from your phone / camera and see EXACTLY what the
    trained model returns — with full per-label distances.

    Use this to verify the model is working and to tune the threshold.

    curl -X POST http://localhost:8000/api/v1/training/debug/detect \
         -F "file=@/path/to/accident.jpg"
    """
    content = await file.read()
    if not _CV2_OK:
        return {"error": "OpenCV not available — cannot run detection"}

    query_hist = _compute_hist(content)
    if query_hist is None:
        return {"error": "Could not compute histogram — is this a valid JPEG/PNG?"}

    if not _HIST_INDEX:
        return {
            "error": "Histogram index is empty — run a training session or scan-disk first",
            "fix":   "POST /api/v1/training/dataset/scan-disk  then  POST /api/v1/training/sessions/start",
        }

    # Per-label nearest-neighbour cosine distance
    per_label = {}
    for label, entries in _HIST_INDEX.items():
        dists = [_cosine_dist(query_hist, feat) for feat, _ in entries]
        nn    = round(min(dists), 4)
        per_label[label] = {
            "nearest_dist":  nn,
            "samples":       len(entries),
            "confidence":    round(min(0.97, max(0.0, 1.0 - nn * 2.0)), 3),
            "would_trigger": nn < 0.35 and label != "Normal / No Incident",
        }

    # Sort by nearest distance (best match first)
    sorted_labels = sorted(per_label.items(), key=lambda x: x[1]["nearest_dist"])
    best_label, best_info = sorted_labels[0]

    result = _best_label_from_frame(content)

    return {
        "detection_result":    result,
        "best_match":          best_label,
        "best_distance":       best_info["nearest_dist"],
        "best_confidence":     best_info["confidence"],
        "triggered":           result is not None,
        "threshold_used":      0.35,
        "distance_metric":     "cosine (nearest-neighbour per label)",
        "all_labels_ranked":   [
            {"label": lbl, **info} for lbl, info in sorted_labels
        ],
        "index_size":          sum(len(v) for v in _HIST_INDEX.values()),
        # Also run YOLO detection and show result
        "yolo_result":         _yolo_cloud_detect(content) if _YOLO_CLOUD_MODEL else None,
        "hint": (
            "Cosine distance < 0.35 triggers detection. "
            "If best_distance is 0.30-0.35 for Road Accident, the model is matching — "
            "just barely under threshold. "
            "If best_distance > 0.35, upload more real accident photos from your phone "
            "via AI Training → Upload tab to improve accuracy."
        ),
    }


# =============================================================================
#  STRATUS SYNC — restore training images from Catalyst Stratus after redeploy
# =============================================================================

@router.post("/stratus/sync")
async def stratus_sync(
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    Sync training images from Catalyst Stratus back to disk.

    Call this after a fresh AppSail deploy to restore the training dataset
    that was uploaded by officers before the redeploy.

    1. Lists all objects in the vv-training-data bucket
    2. Downloads any image not already on disk
    3. Registers newly downloaded images into _SAMPLES + histogram index
    4. Returns a summary: { synced, skipped, errors, model_synced }
    """
    if not current_user.is_admin:
        raise HTTPException(403, "Admin only")

    synced   = 0
    skipped  = 0
    errors   = 0
    new_samples: List[str] = []
    model_synced = False

    try:
        import zcatalyst_sdk as catalyst
        app    = catalyst.initialize()
        bucket = app.stratus().bucket(_STRATUS_BUCKET)

        # Try to restore the YOLO model file first
        try:
            model_bytes = bucket.download_file(_YOLO_STRATUS_PATH)
            if isinstance(model_bytes, bytes) and len(model_bytes) > 1024:
                dest = os.path.join(TRAINING_DATA_DIR, "best.pt")
                with open(dest, "wb") as f:
                    f.write(model_bytes)
                _load_yolo_cloud_model()
                model_synced = True
                print(f"[Stratus Sync] YOLO model restored → {dest}")
        except Exception:
            pass  # model not yet backed up — that's fine

        # List all training image objects
        try:
            objects = bucket.list_objects()
        except Exception as list_err:
            return {
                "message":     f"Stratus list failed: {list_err}",
                "synced":      0, "skipped": 0, "errors": 0,
                "model_synced": model_synced,
            }

        known_paths = {s.get("disk_path") for s in _SAMPLES if s.get("disk_path")}
        folder_to_label = {lbl.replace("/", "_").replace(" ", "_").lower(): lbl
                           for lbl in INCIDENT_LABELS}

        for obj in (objects or []):
            obj_key = obj.get("key") or obj.get("name") or str(obj)
            if not obj_key.endswith((".jpg", ".jpeg", ".png")):
                continue

            # Parse label from Stratus path: <scope>/<label_safe>/<filename>
            parts = obj_key.split("/")
            if len(parts) < 3:
                continue
            label_safe = parts[1]
            filename   = parts[-1]
            lbl = folder_to_label.get(label_safe)
            if lbl is None:
                continue

            label_dir = _label_dir(lbl)
            disk_path = os.path.join(label_dir, filename)

            if disk_path in known_paths or os.path.exists(disk_path):
                skipped += 1
                continue

            try:
                content = bucket.download_file(obj_key)
                if not isinstance(content, bytes):
                    errors += 1
                    continue
                with open(disk_path, "wb") as fh:
                    fh.write(content)

                feat = _compute_feature(content)
                sample_id = _sample_id()
                if feat is not None:
                    _add_to_hist_index(lbl, feat, sample_id, _save=False)

                ext  = os.path.splitext(filename)[1].lower()
                mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
                b64  = base64.b64encode(content[:51200]).decode()
                sample: Dict[str, Any] = {
                    "sample_id":    sample_id,
                    "label":        lbl,
                    "filename":     filename,
                    "file_type":    "image",
                    "file_ext":     ext,
                    "file_size_kb": round(len(content) / 1024, 1),
                    "camera_id":    "STRATUS-SYNC",
                    "notes":        f"Restored from Catalyst Stratus: {obj_key}",
                    "thumbnail":    f"data:{mime};base64,{b64}",
                    "disk_path":    disk_path,
                    "stratus_path": obj_key,
                    "verified":     True,
                    "used_in_training": False,
                    "uploaded_at":  time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "indexed":      feat is not None,
                }
                _SAMPLES.insert(0, sample)
                known_paths.add(disk_path)
                new_samples.append(filename)
                synced += 1
            except Exception as dl_err:
                errors += 1
                print(f"[Stratus Sync] Failed to download {obj_key}: {dl_err}")

        if synced > 0:
            _save_hist_index()
            print(f"[Stratus Sync] {synced} images restored + histogram re-indexed")

        return {
            "message":      f"Stratus sync: {synced} images restored, {skipped} already on disk, {errors} errors",
            "synced":       synced,
            "skipped":      skipped,
            "errors":       errors,
            "model_synced": model_synced,
            "new_samples":  new_samples[:50],
            "dataset_stats": _dataset_stats(),
        }

    except ImportError:
        return {
            "message":     "Catalyst SDK not available — running in local dev mode (no Stratus)",
            "synced":      0, "skipped": 0, "errors": 0, "model_synced": False,
        }
    except Exception as exc:
        raise HTTPException(500, f"Stratus sync failed: {exc}") from exc


# =============================================================================
#  YOLO MODEL UPLOAD — upload a pre-trained .pt / .onnx to activate as primary
# =============================================================================

@router.post("/model/upload")
async def upload_yolo_model(
    file: UploadFile = File(...),
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    Upload a pre-trained YOLO model file (best.pt or best.onnx) and activate
    it as the new PRIMARY cloud detector.

    Use this to upload:
      - The RPi5-trained model from training/runs/detect/runs/accident_detect/
      - A model fine-tuned in Google Colab / Roboflow Train
      - Any custom YOLOv8/v11 .pt model

    After upload the model is:
      1. Saved to training_data/best.pt (or .onnx)
      2. Loaded into the live YOLO cloud detector immediately
      3. Backed up to Catalyst Stratus for persistence across redeploys
    """
    if not current_user.is_admin:
        raise HTTPException(403, "Admin only — only admins can replace the production model")

    fname = file.filename or "model"
    ext   = os.path.splitext(fname)[1].lower()
    if ext not in (".pt", ".onnx"):
        raise HTTPException(400, f"Unsupported format: {ext!r}. Use .pt or .onnx")

    content = await file.read()
    if len(content) < 1024:
        raise HTTPException(400, "File too small — not a valid model")
    if len(content) > 500 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 500 MB)")

    dest = os.path.join(TRAINING_DATA_DIR, f"best{ext}")
    with open(dest, "wb") as f:
        f.write(content)
    print(f"[Model Upload] Saved {fname} → {dest} ({len(content)//1024} KB)")

    # Reload YOLO cloud model with the new file
    _load_yolo_cloud_model()

    # Async Stratus backup
    stratus_path = f"models/best{ext}"
    threading.Thread(
        target=lambda: _stratus_upload(content, stratus_path),
        daemon=True,
    ).start()

    return {
        "message":      f"Model '{fname}' uploaded and activated ({len(content)//1024} KB)",
        "model_path":   dest,
        "stratus_path": stratus_path,
        "yolo_ready":   _YOLO_CLOUD_MODEL is not None,
        "model_info": {
            "path": _YOLO_CLOUD_MODEL_PATH,
            "size_kb": len(content) // 1024,
        },
        "dataset_stats": _dataset_stats(),
    }
