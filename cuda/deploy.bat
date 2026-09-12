@echo off
REM ============================================================
REM  Deploy & Run — Multi-GPU Solver
REM  Rode no Windows: deploy.bat IP usuario senha
REM ============================================================

set IP=%1
set USER=%2
set PASS=%3

if "%IP%"=="" (
    set /p IP="IP da instância: "
)
if "%USER%"=="" (
    set /p USER="Usuário SSH: "
)
if "%PASS%"=="" (
    set /p PASS="Senha SSH: "
)

echo ==========================================
echo  Deploy Multi-GPU Solver
echo  IP: %IP%
echo  User: %USER%
echo ==========================================
echo.

echo [1/4] Copiando arquivos...
scp -r "%~dp0cuda" %USER%@%IP%:/tmp/cuda_setup

echo [2/4] Instalando CUDA e compilando...
ssh %USER%@%IP% "chmod +x /tmp/cuda_setup/setup.sh && bash /tmp/cuda_setup/setup.sh"

echo [3/4] Copiando binário final...
ssh %USER%@%IP% "cp /tmp/cuda_setup/loteria ~/loteria && chmod +x ~/loteria"

echo [4/4] Pronto!
echo.
echo ==========================================
echo  Execute na instância:
echo    ~/loteria --wallet 71 --gpus 8
echo ==========================================
pause
