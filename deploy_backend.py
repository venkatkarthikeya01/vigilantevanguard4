"""Deploy vv-backend to Catalyst AppSail (Docker runtime)."""
import subprocess
import os
import sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))

# Interactive prompts from `catalyst deploy appsail`:
#   1. "Please provide the build directory of your AppSail:" → "backend"
#   2. "Please provide the start command for your AppSail:" → the uvicorn command
inputs = "backend\nuvicorn main:app --host 0.0.0.0 --port 8000 --log-level info\n"

result = subprocess.run(
    "catalyst deploy appsail --name vv-backend",
    input=inputs,
    text=True,
    capture_output=False,
    timeout=600,
    shell=True,
)
sys.exit(result.returncode)
