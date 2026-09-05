#!/bin/bash
# Vast.ai RTX 5090 Setup Script for Webloteria
# Sets up: Xvfb + Chrome + WebGPU + HTTPS + Python server
set -e

echo "=== Webloteria Vast.ai Setup ==="
echo ""

# 1. Install dependencies
echo "[1/7] Installing dependencies..."
apt-get update -qq
apt-get install -y -qq xvfb curl wget unzip chromium-browser vulkan-tools mesa-vulkan-drivers 2>/dev/null || true

# Try to install Chrome if chromium-browser fails
if ! command -v google-chrome &> /dev/null && ! command -v chromium-browser &> /dev/null; then
    echo "  Installing Chrome..."
    wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
    apt-get install -y -qq ./google-chrome-stable_current_amd64.deb 2>/dev/null || true
    rm -f google-chrome-stable_current_amd64.deb
fi

# 2. Find Chrome binary
CHROME_BIN=$(which google-chrome 2>/dev/null || which chromium-browser 2>/dev/null || which chromium 2>/dev/null)
if [ -z "$CHROME_BIN" ]; then
    echo "  ERROR: Chrome not found!"
    exit 1
fi
echo "  Chrome: $CHROME_BIN"

# 3. Setup Xvfb on display :99
echo "[2/7] Starting Xvfb..."
pkill -f "Xvfb :99" 2>/dev/null || true
Xvfb :99 -screen 0 1920x1080x24 -ac &
sleep 1
echo "  Xvfb running on :99"

# 4. Check GPU
echo "[3/7] Checking GPU..."
if command -v nvidia-smi &> /dev/null; then
    nvidia-smi --query-gpu=name,driver_version,compute_cap,memory.total --format=csv,noheader
else
    echo "  WARNING: nvidia-smi not found"
fi

# 5. Check Vulkan
echo "[4/7] Checking Vulkan..."
if command -v vulkaninfo &> /dev/null; then
    vulkaninfo --summary 2>/dev/null | head -10 || echo "  vulkaninfo available but may need display"
else
    echo "  vulkaninfo not found (install with: apt install vulkan-tools)"
fi

# 6. Download latest Webloteria
echo "[5/7] Downloading Webloteria..."
cd ~
if [ -f index.html ]; then
    echo "  index.html exists, updating..."
fi
# Try to download from latest upload
curl -sL "https://files.catbox.moe/309en4.html" -o index.html 2>/dev/null || echo "  Could not download (using existing)"

# 7. Start HTTP server
echo "[6/7] Starting HTTP server..."
pkill -f "python3 -m http.server" 2>/dev/null || true
python3 -m http.server 9999 &
sleep 1
echo "  Server running on http://localhost:9999"

# 8. Launch Chrome with WebGPU flags
echo "[7/7] Launching Chrome with WebGPU flags..."
DISPLAY=:99 "$CHROME_BIN" \
    --no-sandbox \
    --disable-gpu-sandbox \
    --enable-unsafe-webgpu \
    --enable-features=Vulkan,UseSkiaRenderer \
    --use-angle=vulkan \
    --ignore-gpu-blocklist \
    --disable-software-rasterizer \
    --window-size=1920,1080 \
    http://localhost:9999/index.html &

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Chrome should be open with Webloteria."
echo "To check WebGPU status: open chrome://gpu in Chrome"
echo ""
echo "If WebGPU is NOT detected, try:"
echo "  1. Close all Chrome windows"
echo "  2. Run: DISPLAY=:99 $CHROME_BIN --no-sandbox --enable-unsafe-webgpu --use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist http://localhost:9999/index.html"
echo ""
echo "Alternative (Vulkan EGL):"
echo "  DISPLAY=:99 $CHROME_BIN --no-sandbox --enable-unsafe-webgpu --use-gl=egl --ignore-gpu-blocklist http://localhost:9999/index.html"
