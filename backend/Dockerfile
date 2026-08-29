FROM python:3.11-slim

WORKDIR /app

# System deps for OpenCV-headless (needs libGL) + scikit-learn (gcc)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libglib2.0-0 \
    libgl1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies first (layer-cached unless requirements.txt changes)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code (excludes everything in .dockerignore)
COPY . .

# Create a writable directory for training data / model files
# AppSail containers are read-only except for /tmp and explicitly created dirs
RUN mkdir -p /app/training_data && chmod 777 /app/training_data

EXPOSE 8000

# Single worker — AppSail scales via instance_count, not per-container workers
# --workers 1 ensures the in-memory stores (_INCIDENTS, _HIST_INDEX, _RF_STATE)
# are consistent within a single pod. For multi-pod setups, migrate to Redis.
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--timeout-keep-alive", "75", \
     "--log-level", "info"]
