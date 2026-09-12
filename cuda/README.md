# Multi-GPU Bitcoin Puzzle Solver (CUDA)

Port CUDA do WebGPU pipeline para máximo desempenho em GPUs NVIDIA.

## Performance Estimada

| Config | Throughput | Tempo para 2^64 |
|--------|-----------|-----------------|
| 1x RTX 5090 | ~4-6 GH/s | ~35 dias |
| 4x RTX 5090 | ~16-24 GH/s | ~9 dias |
| 8x RTX 5090 | ~32-48 GH/s | **~4-5 dias** |

## Requisitos

- Ubuntu 20.04+ / Debian 11+
- CUDA Toolkit 11.0+ (12.x recomendado)
- NVIDIA GPU(s) com compute capability 7.0+
- GCC/G++

## Instalação

```bash
# Instalar CUDA (Ubuntu 22.04)
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb
sudo apt update
sudo apt install cuda

# Ou via apt (versão mais antiga)
sudo apt install nvidia-cuda-toolkit

# Compilar
cd cuda/
chmod +x build.sh
./build.sh
```

## Uso

```bash
# Auto-detect todas as GPUs
./loteria --wallet 71

# Especificar número de GPUs
./loteria --wallet 71 --gpus 8

# Wallet específica
./loteria --wallet 65 --gpus 4

# Usar script helper
./run.sh 71 8
```

## Arquitetura

```
┌─────────────────────────────────────────────────┐
│                   Host (CPU)                     │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐         │
│  │  GPU 0  │  │  GPU 1  │  │  GPU N  │  ...    │
│  │ Worker  │  │ Worker  │  │ Worker  │         │
│  └────┬────┘  └────┬────┘  └────┬────┘         │
│       │             │             │              │
│  ┌────▼────┐  ┌────▼────┐  ┌────▼────┐         │
│  │ Stream  │  │ Stream  │  │ Stream  │         │
│  │ 0       │  │ 1       │  │ N       │         │
│  └────┬────┘  └────┬────┘  └────┬────┘         │
│       │             │             │              │
│  ┌────▼─────────────▼─────────────▼────┐        │
│  │         Kernel: search_kernel       │        │
│  │  - secp256k1 scalar_mul (Batchelorette) │    │
│  │  - SHA-256 + RIPEMD-160            │        │
│  │  - Hash160 match                   │        │
│  └─────────────────────────────────────┘        │
└─────────────────────────────────────────────────┘
```

## Cada GPU

1. Recebe sua porção do range de keys
2. Para cada batch:
   - CPU computa base point (k*G)
   - Upload para GPU
   - Kernel busca BATCH_SIZE keys sequenciais
   - Verifica match com target hash160
3. Reporta progresso e finds ao coordinator

## Flags

| Flag | Descrição | Default |
|------|-----------|---------|
| `--wallet N` | Número da wallet | 71 |
| `--gpus N` | Número de GPUs | auto |
| `--batch N` | Keys por thread | 128 |
| `--start HEX` | Key inicial | range da wallet |
| `--end HEX` | Key final | range da wallet |

## Otimização

### Ajustar batch size
```bash
# Testar diferentes batch sizes
./loteria --wallet 71 --batch 64
./loteria --wallet 71 --batch 128
./loteria --wallet 71 --batch 256
```

### Monitorar GPUs
```bash
# Em outro terminal
nvidia-smi -l 1
```

### Multi-GPU scaling
```bash
# 1 GPU
./loteria --wallet 71 --gpus 1

# 2 GPUs
./loteria --wallet 71 --gpus 2

# 4 GPUs
./loteria --wallet 71 --gpus 4

# 8 GPUs (máximo)
./loteria --wallet 71 --gpus 8
```

## Troubleshooting

### "CUDA error: no CUDA-capable device is detected"
```bash
# Verificar GPUs
nvidia-smi

# Instalar driver
sudo apt install nvidia-driver-535
```

### "CUDA error: out of memory"
- Reduza `--batch` (ex: 64 ou 32)
- Feche outros programas que usam GPU

### Build error: "nvcc not found"
```bash
export PATH=/usr/local/cuda/bin:$PATH
export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH
```

## Comparação: CUDA vs WebGPU

| | WebGPU | CUDA |
|---|---|---|
| Throughput/GPU | ~1.5-2 GH/s | ~4-6 GH/s |
| 8 GPUs | ~12-16 GH/s | **~32-48 GH/s** |
| Overhead | Browser + WebGL | Nativo |
| Setup | Nenhum | CUDA toolkit |
| Multi-GPU | 8 abas | 1 processo |

## Roadmap

- [ ] Adicionar mais wallets
- [ ] Base58Check decoding para targets
- [ ] Modo random (non-sequential)
- [ ] Wallet import/export
- [ ] API para integração
