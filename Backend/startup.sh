#!/bin/sh
# Install Pillow into a known directory using Azure's own Python (correct ABI).
# PYTHONPATH=/home/site/wwwroot/python_libs is set as an Azure App Setting
# so both this script and Node's child_process.spawn can find PIL.
PYLIB=/home/site/wwwroot/python_libs
mkdir -p "$PYLIB"
python3 -c "import sys; sys.path.insert(0,'$PYLIB'); import PIL" 2>/dev/null \
  || python3 -m pip install -q --disable-pip-version-check --target "$PYLIB" Pillow==11.3.0
exec node --max-old-space-size=2048 dist/index.js

