#!/bin/bash
# Deploy to Vast.ai instance
# Usage: bash deploy-vast.sh <vast_instance_ip> <ssh_port>

set -e

if [ -z "$1" ]; then
    echo "Usage: bash deploy-vast.sh <vast_instance_ip> <ssh_port>"
    echo "Example: bash deploy-vast.sh 123.45.67.89 12345"
    exit 1
fi

VAST_IP=$1
VAST_PORT=${2:-22}
VAST_USER="root"
REMOTE_DIR="/workspace/loteria"

echo "=== Deploying to Vast.ai ==="
echo "Target: ${VAST_USER}@${VAST_IP}:${VAST_PORT}"
echo ""

# Build locally first (cross-compile check)
echo "[1/4] Checking local files..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "${SCRIPT_DIR}/loteria_cuda.cu" ]; then
    echo "ERROR: loteria_cuda.cu not found in ${SCRIPT_DIR}"
    exit 1
fi

# Create remote directory
echo "[2/4] Creating remote directory..."
ssh -p ${VAST_PORT} ${VAST_USER}@${VAST_IP} "mkdir -p ${REMOTE_DIR}"

# Upload files
echo "[3/4] Uploading CUDA source..."
scp -P ${VAST_PORT} \
    "${SCRIPT_DIR}/loteria_cuda.cu" \
    "${SCRIPT_DIR}/build.sh" \
    "${SCRIPT_DIR}/run.sh" \
    ${VAST_USER}@${VAST_IP}:${REMOTE_DIR}/

# Build and run on remote
echo "[4/4] Building on remote instance..."
ssh -p ${VAST_PORT} ${VAST_USER}@${VAST_IP} << 'REMOTECommands'
    cd /workspace/loteria
    chmod +x build.sh run.sh
    
    # Check CUDA
    echo "=== GPU Info ==="
    nvidia-smi --query-gpu=name,memory.total,compute_cap --format=csv,noheader
    
    # Build
    echo ""
    echo "=== Building ==="
    bash build.sh
    
    echo ""
    echo "=== Build complete! ==="
    echo "To run: cd /workspace/loteria && ./loteria --wallet 71"
REMOTECommands

echo ""
echo "=== Deploy complete! ==="
echo ""
echo "To connect:"
echo "  ssh -p ${VAST_PORT} ${VAST_USER}@${VAST_IP}"
echo ""
echo "To run:"
echo "  cd /workspace/loteria"
echo "  ./loteria --wallet 71"
echo ""
