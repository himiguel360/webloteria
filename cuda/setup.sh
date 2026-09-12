#!/bin/bash
# ============================================================
#  Setup completo — Multi-GPU Bitcoin Puzzle Solver
#  Rode este script na instância Ubuntu
#  Uso: bash setup.sh
# ============================================================

set -e

echo "=========================================="
echo "  Setup Multi-GPU Bitcoin Puzzle Solver"
echo "=========================================="
echo ""

# 1. Detectar sistema
echo "[1/7] Detectando sistema..."
OS=$(lsb_release -is 2>/dev/null || echo "Ubuntu")
VER=$(lsb_release -rs 2>/dev/null || echo "22.04")
echo "  Sistema: $OS $VER"

# 2. Atualizar pacotes
echo "[2/7] Atualizando pacotes..."
sudo apt update -qq

# 3. Instalar dependências
echo "[3/7] Instalando dependências..."
sudo apt install -y -qq build-essential wget curl

# 4. Instalar CUDA (se não tiver)
echo "[4/7] Verificando CUDA..."
if command -v nvcc &> /dev/null; then
    echo "  CUDA já instalado: $(nvcc --version | grep release)"
else
    echo "  Instalando CUDA toolkit..."
    
    # Detectar versão do Ubuntu
    UBUNTU_VER=$(lsb_release -cs 2>/dev/null || echo "jammy")
    
    # Instalar CUDA via apt
    wget -q https://developer.download.nvidia.com/compute/cuda/repos/${UBUNTU_VER}/x86_64/cuda-keyring_1.1-1_all.deb
    sudo dpkg -i cuda-keyring_1.1-1_all.deb
    sudo apt update -qq
    sudo apt install -y -qq cuda
    
    # Adicionar ao PATH
    echo 'export PATH=/usr/local/cuda/bin:$PATH' >> ~/.bashrc
    echo 'export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH' >> ~/.bashrc
    source ~/.bashrc
    
    rm -f cuda-keyring_1.1-1_all.deb
    echo "  CUDA instalado com sucesso!"
fi

# 5. Verificar GPUs
echo "[5/7] Detectando GPUs NVIDIA..."
if command -v nvidia-smi &> /dev/null; then
    GPU_COUNT=$(nvidia-smi --query-gpu=count --format=csv,noheader | head -1)
    echo "  GPUs encontradas: $GPU_COUNT"
    nvidia-smi --query-gpu=index,name,memory.total,compute_cap --format=csv,noheader
else
    echo "  AVISO: nvidia-smi não encontrado!"
    echo "  Instale o driver NVIDIA:"
    echo "    sudo apt install nvidia-driver-535"
fi

# 6. Detectar GPU architecture
echo "[6/7] Detectando arquitetura GPU..."
if command -v nvidia-smi &> /dev/null; then
    CC=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader | head -1 | tr -d '.')
    if [ -n "$CC" ]; then
        ARCH="sm_${CC}"
        echo "  Arquitetura: ${ARCH}"
    else
        ARCH="sm_75"
        echo "  Arquitetura padrão: ${ARCH}"
    fi
else
    ARCH="sm_75"
fi

# 7. Compilar
echo "[7/7] Compilando solver..."
cd "$(dirname "$0")"

# Verificar se tem CUDA sources
if [ ! -f loteria_cuda.cu ]; then
    echo "  ERRO: loteria_cuda.cu não encontrado!"
    echo "  Certifique-se de que está na pasta correta."
    exit 1
fi

nvcc -O3 \
    -arch=${ARCH} \
    -o loteria \
    loteria_cuda.cu \
    -lm \
    -lpthread \
    -allow-unsupported-compiler

if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "  SETUP COMPLETO!"
    echo "=========================================="
    echo ""
    echo "Para rodar:"
    echo "  ./loteria --wallet 71 --gpus 8"
    echo ""
    echo "Para rodar com todas as GPUs:"
    echo "  ./loteria --wallet 71"
    echo ""
    echo "Wallets disponíveis: 65-100"
    echo ""
    echo "Para monitorar GPUs:"
    echo "  nvidia-smi -l 1"
    echo ""
else
    echo ""
    echo "ERRO: Falha na compilação!"
    echo "Verifique se o CUDA toolkit está instalado corretamente."
    exit 1
fi
