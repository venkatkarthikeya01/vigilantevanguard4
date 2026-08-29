"""
Standalone benchmark runner — no FastAPI server needed.
Run: python run_benchmark.py   (from the backend/ folder or from repo root with adjusted path)
"""
import sys, os, json

# ── Set working dir to backend/ so relative paths inside training.py work ───
_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.join(_HERE, "backend")
os.chdir(_BACKEND)
sys.path.insert(0, _BACKEND)

# ── Minimal stubs so training.py can be imported without a running server ────
import types

# Stub pydantic BaseModel (only import-time usage)
try:
    import pydantic
except ImportError:
    pydantic = types.ModuleType("pydantic")
    pydantic.BaseModel = object
    sys.modules["pydantic"] = pydantic

# Stub FastAPI
fa = types.ModuleType("fastapi")

class _Dep:
    def __init__(self, *a, **kw): pass
    def __call__(self, *a, **kw): return self

class _Router:
    def __init__(self, *a, **kw): pass
    def get(self, *a, **kw):    return lambda f: f
    def post(self, *a, **kw):   return lambda f: f
    def patch(self, *a, **kw):  return lambda f: f
    def delete(self, *a, **kw): return lambda f: f

fa.APIRouter    = _Router
fa.File         = _Dep
fa.Form         = _Dep
fa.HTTPException = Exception
fa.UploadFile   = _Dep
fa.Depends      = _Dep

for mod in ["fastapi", "fastapi.responses", "fastapi.staticfiles"]:
    sys.modules.setdefault(mod, types.ModuleType(mod))
sys.modules["fastapi"] = fa

resp = types.ModuleType("fastapi.responses")
resp.FileResponse   = _Dep
resp.JSONResponse   = _Dep
resp.StreamingResponse = _Dep
sys.modules["fastapi.responses"] = resp

# Stub zcatalyst_sdk (optional, not needed for benchmark)
zc = types.ModuleType("zcatalyst_sdk")
zc.initialize = lambda: None
sys.modules["zcatalyst_sdk"] = zc

# Stub app.core.auth so the import doesn't fail
auth_core = types.ModuleType("app.core.auth")
auth_core.verify_catalyst_token = lambda: None
auth_core.AuthUser = object
sys.modules["app"] = types.ModuleType("app")
sys.modules["app.core"] = types.ModuleType("app.core")
sys.modules["app.core.auth"] = auth_core

# ── Now safely import the training module ────────────────────────────────────
import importlib.util
spec = importlib.util.spec_from_file_location(
    "app.routers.training",
    os.path.join(_BACKEND, "app", "routers", "training.py"),
)
m = importlib.util.module_from_spec(spec)
sys.modules["app.routers.training"] = m
spec.loader.exec_module(m)

print(f"[OK] Module loaded  sklearn={m._SKLEARN_OK}  opencv={m._CV2_OK}")
print(f"     Training data dir: {m.TRAINING_DATA_DIR}")

# ── Run the benchmark ─────────────────────────────────────────────────────────
print("\n[BENCH] Starting multi-algorithm benchmark...\n")
result = m.run_algorithm_benchmark(force=True)
print("\n[BENCH] === RESULTS ===")
print(json.dumps(result, indent=2, default=str))
print(f"\n[BENCH] Best algorithm: {result.get('best_algorithm')}")
print(f"[BENCH] SVM retrain:    {result.get('svm_retrain_status')}")
