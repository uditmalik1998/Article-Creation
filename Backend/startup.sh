#!/bin/sh
# Install Pillow using Azure's own Python so the wheel ABI matches exactly.
# The check-before-install avoids a slow pip round-trip on every restart.
python3 -c "import PIL" 2>/dev/null || pip3 install -q --disable-pip-version-check --user Pillow==11.3.0
exec node --max-old-space-size=2048 dist/index.js
