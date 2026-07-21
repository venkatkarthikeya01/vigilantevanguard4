"""
VigilanteVanguard — single deploy script.

Produces ONE zip:  vigilante-vanguard-deploy.zip

  Contains everything Catalyst needs:
    - frontend/dist/          (built React app  -> Slate upload)
    - backend/                (FastAPI + Node   -> AppSail upload)
    - catalyst.json / client.config.json / appsail.json
    - data/migrations + seeds
    - circuits/
    - functions/

  Use it for:
    - Catalyst Console -> Upload App  (full project)
    - OR extract frontend/dist/ -> upload to Slate
    - OR extract backend/       -> upload to AppSail
"""
import os, zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(ROOT, 'vigilante-vanguard-deploy.zip')

SKIP_DIRS  = {'venv', '_venv_bak', 'node_modules', '__pycache__', '.git', '.idea', '.vscode'}
SKIP_EXT   = ('.pyc', '.pyo', '.DS_Store', 'Thumbs.db')
SKIP_FILES = {
    'write_launch.py', 'deploy_backend.py', 'test_health.py', 'test_login.py',
    'make_deploy_zip.py', 'make_zips.py', '.env',
    'vigilante-vanguard-deploy.zip', 'vv-backend-deploy.zip',
    'vv-frontend-dist.zip', 'vv-frontend-source.zip',
}

# Verify dist exists
DIST_DIR = os.path.join(ROOT, 'frontend', 'dist')
if not os.path.isdir(DIST_DIR):
    print('ERROR: frontend/dist/ not found.')
    print('Run this first:  cd frontend && npm run build')
    raise SystemExit(1)

print(f'\nBuilding: {OUT}\n')

n = 0
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for dp, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith('.')]
        for fn in files:
            if any(fn.endswith(e) for e in SKIP_EXT): continue
            if fn in SKIP_FILES: continue
            full = os.path.join(dp, fn)
            arc  = os.path.relpath(full, ROOT)
            zf.write(full, arc)
            n += 1
            print(f'  {arc}')

sz = round(os.path.getsize(OUT) / 1_048_576, 1)
print(f'\nDone: {n} files | {sz} MB')
print(f'\n  {OUT}')
print('\nThis zip contains:')
print('  frontend/dist/   -> upload to Catalyst Slate')
print('  backend/         -> upload to Catalyst AppSail')
print('  (or upload the whole zip via Console -> Upload App)')
