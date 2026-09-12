#!/bin/bash
# Run script for Multi-GPU Bitcoin Puzzle Solver
# Usage: ./run.sh [wallet_number] [num_gpus]

WALLET=${1:-71}
GPUS=${2:-0}

echo "=== Multi-GPU Bitcoin Puzzle Solver ==="
echo "Wallet: #${WALLET}"
if [ "$GPUS" -gt 0 ]; then
    echo "GPUs: ${GPUS}"
else
    echo "GPUs: auto-detect all"
fi
echo ""

# Check if binary exists
if [ ! -f ./loteria ]; then
    echo "Binary not found. Running build.sh first..."
    bash build.sh
fi

# Run
./loteria --wallet ${WALLET} --gpus ${GPUS}
