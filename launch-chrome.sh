#!/bin/bash
# RTX 5090 (Blackwell) + Headless Chrome + WebGPU
# 1) Start dbus (Chrome expects it)
/etc/init.d/dbus start 2>/dev/null

# 2) Set Vulkan ICD
export VK_ICD_FILENAMES=/etc/vulkan/icd.d/nvidia_icd.json

# 3) Verify Vulkan works
echo "=== Checking Vulkan ==="
vulkaninfo --summary 2>/dev/null || echo "WARNING: vulkaninfo not found or failed"

# 4) Launch Chrome with ALL required flags
google-chrome \
  --no-sandbox \
  --headless=new \
  --enable-unsafe-webgpu \
  --enable-features=Vulkan \
  --use-angle=vulkan \
  --disable-vulkan-surface \
  --ignore-gpu-blocklist \
  --disable-gpu-sandbox \
  --enable-dawn-features=allow_unsafe_apis,disable_adapter_blocklist \
  --disable-dawn-features=disallow_unsafe_apis \
  https://webloteria.vercel.app
