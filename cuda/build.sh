#!/bin/bash
# Build script for Multi-GPU Bitcoin Puzzle Solver (CUDA) v2 - Batch Inversion
# Tested on Ubuntu 22.04 with CUDA 12.x

set -e

echo "=== Building Multi-GPU CUDA Solver v2 (Batch Inversion) ==="
echo ""

# Check for nvcc
if ! command -v nvcc &> /dev/null; then
    echo "ERROR: nvcc not found!"
    echo "Install CUDA toolkit:"
    echo "  sudo apt install nvidia-cuda-toolkit"
    exit 1
fi

# Detect GPU architecture(s)
echo "Detecting GPU architecture..."
GPU_COUNT=$(nvidia-smi --query-gpu=count --format=csv,noheader 2>/dev/null | head -1)
if [ -z "$GPU_COUNT" ] || [ "$GPU_COUNT" -eq 0 ]; then
    echo "WARNING: No NVIDIA GPUs detected. Building for sm_75 (Turing)."
    ARCH_FLAGS="-gencode arch=compute_75,code=sm_75"
else
    # Get unique compute capabilities
    CC_LIST=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader 2>/dev/null | sort -u | tr -d '.')
    ARCH_FLAGS=""
    for CC in $CC_LIST; do
        ARCH_FLAGS="${ARCH_FLAGS} -gencode arch=compute_${CC},code=sm_${CC}"
        echo "  Detected: sm_${CC}"
    done
    if [ -z "$ARCH_FLAGS" ]; then
        ARCH_FLAGS="-gencode arch=compute_75,code=sm_75"
        echo "  Defaulting to sm_75"
    fi
fi

echo "Compiling..."
echo ""

# Compile with fat binary support for all detected GPUs
nvcc -O3 \
    ${ARCH_FLAGS} \
    -o loteria \
    loteria_cuda.cu \
    -lm \
    -lpthread \
    -allow-unsupported-compiler

if [ $? -eq 0 ]; then
    echo ""
    echo "=== Build successful! ==="
    echo ""
    echo "Optimization: 128-key batch Montgomery inversion per thread"
    echo "  Before: 128 individual Fermat exponentiations per thread"
    echo "  After:  1 Fermat + 127 multiplications per thread (~128x faster inversion)"
    echo ""
    echo "Binary: ./loteria"
    echo ""
    echo "Usage:"
    echo "  ./loteria --wallet 71 --gpus 8"
    echo "  ./loteria --wallet 65 --gpus 4"
    echo ""
else
    echo "Build failed!"
    exit 1
fi
