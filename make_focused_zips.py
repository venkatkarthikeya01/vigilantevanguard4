"""
Produces three focused deployment zips:
  vv-frontend-dist.zip    — built dist/ only  (upload to Catalyst Slate)
  vv-frontend-source.zip  — full frontend src (no node_modules, no dist)
  vv-backend-deploy.zip   — backend/ only     (upload to Catalyst AppSail)
"""
import os, zipfile

ROOT       = os.path.dirname(os.path.abspath(__file__))
SKIP_EXT   = ('.pyc', '.pyo', '.DS_Store', 'Thumbs.db')

# ── 1. vv-frontend-dist.zip ─────────────────────────────────────
out1     = os.path.join(ROOT, 'vv-frontend-dist.zip')
dist_dir = os.path.join(ROOT, 'frontend', 'dist')
n1 = 0
with zipfile.ZipFile(out1, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for dp, dirs, files in os.walk(dist_dir):
        for fn in files:
            if any(fn.endswith(e) for e in SKIP_EXT): continue
            full = os.path.join(dp, fn)
            arc  = os.path.relpath(full, dist_dir)
            zf.write(full, arc)
            n1 += 1
            print(f'  [dist]   {arc}')
print(f'\nvv-frontend-dist.zip   — {n1} files | {os.path.getsize(out1)/1_048_576:.1f} MB')

# ── 2. vv-frontend-source.zip ───────────────────────────────────
out2   = os.path.join(ROOT, 'vv-frontend-source.zip')
fe_dir = os.path.join(ROOT, 'frontend')
SKIP_FE = {'node_modules', 'dist', '__pycache__', '.git'}
n2 = 0
with zipfile.ZipFile(out2, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for dp, dirs, files in os.walk(fe_dir):
        dirs[:] = [d for d in dirs if d not in SKIP_FE and not d.startswith('.')]
        for fn in files:
            if any(fn.endswith(e) for e in SKIP_EXT): continue
            if fn == '.env': continue
            full = os.path.join(dp, fn)
            arc  = os.path.relpath(full, fe_dir)
            zf.write(full, arc)
            n2 += 1
            print(f'  [src]    {arc}')
print(f'\nvv-frontend-source.zip — {n2} files | {os.path.getsize(out2)/1_048_576:.1f} MB')

# ── 3. vv-backend-deploy.zip ────────────────────────────────────
out3   = os.path.join(ROOT, 'vv-backend-deploy.zip')
be_dir = os.path.join(ROOT, 'backend')
SKIP_BE = {'node_modules', '__pycache__', 'venv', '_venv_bak', '.git'}
n3 = 0
with zipfile.ZipFile(out3, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for dp, dirs, files in os.walk(be_dir):
        dirs[:] = [d for d in dirs if d not in SKIP_BE and not d.startswith('.')]
        for fn in files:
            if any(fn.endswith(e) for e in SKIP_EXT): continue
            if fn == '.env': continue
            full = os.path.join(dp, fn)
            arc  = os.path.relpath(full, be_dir)
            zf.write(full, arc)
            n3 += 1
            print(f'  [backend]{arc}')
print(f'\nvv-backend-deploy.zip  — {n3} files | {os.path.getsize(out3)/1_048_576:.1f} MB')

print('\n─────────────────────────────────────────────────────')
print('All zips ready in:', ROOT)
print('  vv-frontend-dist.zip    → Catalyst Slate upload')
print('  vv-frontend-source.zip  → source backup / dev handoff')
print('  vv-backend-deploy.zip   → Catalyst AppSail upload')
print('  vigilante-vanguard-deploy.zip → full project (already built)')
