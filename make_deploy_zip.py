"""
Creates a clean deployment zip of VigilanteVanguard for Catalyst Console upload.
Excludes: venv, node_modules, __pycache__, dist, .pyc, .git
Output: vigilante-vanguard-deploy.zip  (in the project root)
"""
import os
import zipfile

ROOT   = os.path.dirname(os.path.abspath(__file__))
OUT    = os.path.join(ROOT, 'vigilante-vanguard-deploy.zip')

# Directories / patterns to skip entirely
SKIP_DIRS = {
    'venv', '_venv_bak', 'node_modules', '__pycache__',
    'dist', '.git', '.idea', '.vscode',
}
SKIP_FILES = {
    '.pyc', '.pyo', '.DS_Store', 'Thumbs.db',
    'vigilante-vanguard-deploy.zip',
}
SKIP_NAMES = {
    'write_launch.py', 'deploy_backend.py',
    'test_health.py', 'test_login.py',
    '.env',               # never include secrets
}

count = 0

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for dirpath, dirnames, filenames in os.walk(ROOT):
        # Prune skip dirs in-place so os.walk doesn't descend into them
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith('.')]

        for fname in filenames:
            # Skip by extension
            if any(fname.endswith(ext) for ext in SKIP_FILES):
                continue
            # Skip by exact name
            if fname in SKIP_NAMES:
                continue

            full = os.path.join(dirpath, fname)
            arcname = os.path.relpath(full, ROOT)

            zf.write(full, arcname)
            count += 1
            print(f'  + {arcname}')

size_mb = os.path.getsize(OUT) / 1_048_576
print()
print(f'Done: {count} files  →  {OUT}')
print(f'Size: {size_mb:.1f} MB')
