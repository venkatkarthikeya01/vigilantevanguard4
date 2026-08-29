import sys, os, glob
sys.path.insert(0, '.')
from app.routers.training import (
    _HIST_INDEX, _best_label_from_frame, _compute_feature,
    _cosine_dist, detect_from_training, NORMAL_SCENE_SENTINEL
)
import cv2, numpy as np

road   = glob.glob('training_data/road_accident/*.jpg')[:10]
normal = glob.glob('training_data/normal___no_incident/*.jpg')[:10]

ok_road, ok_norm = 0, 0

print('=== Road accident (should detect) ===')
for p in road:
    with open(p,'rb') as f: b = f.read()
    r = detect_from_training(b)
    itype = r.get('incident_type') if r else None
    hit = itype and itype not in ('__NORMAL__',)
    if hit: ok_road += 1
    print(f'  {"HIT" if hit else "MISS"}: {os.path.basename(p)} -> {itype}')
print(f'Score: {ok_road}/{len(road)}')

print()
print('=== Normal images (should NOT detect) ===')
for p in normal:
    with open(p,'rb') as f: b = f.read()
    r = detect_from_training(b)
    itype = r.get('incident_type') if r else None
    safe = (r is None or itype in ('__NORMAL__', NORMAL_SCENE_SENTINEL))
    if safe: ok_norm += 1
    print(f'  {"OK" if safe else "FALSE_ALARM"}: {os.path.basename(p)} -> {itype}')
print(f'Score: {ok_norm}/{len(normal)}')

print()
print('=== Synthetic desk/laptop scenes (must NOT detect) ===')
scenes = {
    'plain_grey': np.ones((240,320,3), dtype=np.uint8) * 128,
    'laptop_screen': np.zeros((240,320,3), dtype=np.uint8),
    'warm_indoor': np.full((240,320,3), [80,90,120], dtype=np.uint8),
}
for name, img in scenes.items():
    _, buf = cv2.imencode('.jpg', img)
    b = buf.tobytes()
    r = detect_from_training(b)
    itype = r.get('incident_type') if r else None
    safe = (r is None or itype in ('__NORMAL__', NORMAL_SCENE_SENTINEL))
    print(f'  {"OK" if safe else "FALSE_ALARM"}: {name} -> {itype}')

print()
print('Index sizes:', {k: len(v) for k,v in _HIST_INDEX.items()})
