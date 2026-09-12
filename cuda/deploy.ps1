# ============================================================
#  Deploy Multi-GPU Solver (PowerShell)
#  Uso: .\deploy.ps1 -IP 192.168.1.100 -User miguel -Pass senha
# ============================================================

param(
    [string]$IP,
    [string]$User,
    [string]$Pass
)

if (-not $IP) { $IP = Read-Host "IP da instância" }
if (-not $User) { $User = Read-Host "Usuário SSH" }
if (-not $Pass) { $Pass = Read-Host "Senha SSH" }

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Deploy Multi-GPU Solver" -ForegroundColor Cyan
Write-Host " IP: $IP" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Copiar arquivos
Write-Host "[1/4] Copiando arquivos..." -ForegroundColor Yellow
$localPath = "$PSScriptRoot\cuda"
$remotePath = "/tmp/cuda_setup"

# Usar SCP (precisa estar no PATH)
scp -r "$localPath" "$User@$IP`:$remotePath"

# 2. Setup remoto
Write-Host "[2/4] Instalando CUDA e compilando..." -ForegroundColor Yellow
ssh "$User@$IP" "chmod +x $remotePath/setup.sh && bash $remotePath/setup.sh"

# 3. Copiar binário
Write-Host "[3/4] Copiando binário final..." -ForegroundColor Yellow
ssh "$User@$IP" "cp $remotePath/loteria ~/loteria && chmod +x ~/loteria"

# 4. Pronto
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host " SETUP COMPLETO!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Execute na instância:" -ForegroundColor Cyan
Write-Host "  ssh $User@$IP" -ForegroundColor White
Write-Host "  ~/loteria --wallet 71 --gpus 8" -ForegroundColor White
Write-Host ""
Write-Host "Ou diretamente daqui:" -ForegroundColor Yellow
Write-Host "  ssh $User@$IP `"~/loteria --wallet 71 --gpus 8`"" -ForegroundColor White
