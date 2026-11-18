import sys
from pathlib import Path

# Reuse the inspector tests' synthetic container builders (Ogg Opus, MP3) without copying them.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "processing"))
