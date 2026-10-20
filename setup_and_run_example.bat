@echo off
REM EdenLive: create the venv, fetch the 5B weights, run the shipped example.
REM
REM Deviations from README.md, which targets Linux + conda + an 80 GB GPU:
REM   - uv instead of conda, Python 3.11 instead of 3.10 (3.12 deadlocks on Windows)
REM   - only the 5B bidirectional subset is fetched: 36.6 GB, not the full 210 GB.
REM     The 14B DiTs (131 GB), flux-c2f, clip and the decoders are real-time or
REM     14B-only and the offline example does not read them.
REM   - the real-time service is skipped entirely: no playwright, no npm.
setlocal enabledelayedexpansion

set ROOT=%~dp0
set VENV=%ROOT%.venv
set MODELS=%ROOT%models\EdenLive
set NEED_GB=45
set SKIP_MODELS=0
if /I "%~1"=="--no-models" set SKIP_MODELS=1
if "%SKIP_MODELS%"=="1" set NEED_GB=6

echo === checking free disk ===
REM wmic is gone on Windows 11 and a bash-first PATH shadows find.exe,
REM so ask PowerShell directly. Advisory only: never abort on a failed probe.
set FREEGB=0
for /f %%F in ('powershell -NoProfile -Command "[int]((Get-PSDrive C).Free/1GB)" 2^>nul') do set FREEGB=%%F
echo     %FREEGB% GB free, need %NEED_GB% GB
if !FREEGB! EQU 0 echo     could not read free space, continuing
if !FREEGB! GTR 0 if !FREEGB! LSS %NEED_GB% (
    echo.
    echo ABORT: the 5B subset needs 36.6 GB plus working room.
    echo        dit-5b-bidir 20.0, umt5 11.4, vae-5b 2.8, vision-encoder 2.4
    exit /b 1
)

echo.
echo === 1/4 venv ===
if not exist "%VENV%" uv venv --python 3.11 "%VENV%"

echo.
echo === 2/4 torch, CUDA 13 ===
uv pip install --python "%VENV%\Scripts\python.exe" torch==2.13.0 torchvision==0.28.0 --index-url https://download.pytorch.org/whl/cu130
if errorlevel 1 exit /b 1
"%VENV%\Scripts\python.exe" -c "import torch;assert torch.cuda.is_available(),'CUDA not visible';print('torch',torch.__version__,torch.cuda.get_device_name(0))"
if errorlevel 1 exit /b 1

echo.
echo === 3/4 edenlive and inference deps ===
REM --no-deps on the package itself so the pinned torch above is not replaced.
uv pip install --python "%VENV%\Scripts\python.exe" accelerate diffusers transformers ftfy huggingface-hub imageio imageio-ffmpeg numpy pillow PyYAML safetensors pandas pyarrow av
if errorlevel 1 exit /b 1
uv pip install --python "%VENV%\Scripts\python.exe" --no-deps -e "%ROOT%"
if errorlevel 1 exit /b 1
REM decord has no Windows wheel; the manifest reader falls back to imageio without it.
uv pip install --python "%VENV%\Scripts\python.exe" decord 2>nul || echo     decord unavailable on Windows, continuing with imageio

echo.
if "%SKIP_MODELS%"=="1" (
    echo.
    echo === weights and example skipped: --no-models ===
    echo     rerun without the flag once %NEED_GB% GB is free
    exit /b 0
)
echo === 4/4 weights, 5B subset only ===
if not exist "%MODELS%" mkdir "%MODELS%"
"%VENV%\Scripts\python.exe" -m huggingface_hub.commands.huggingface_cli download VAST-AI/EdenLive --local-dir "%MODELS%" --include "dit-5b-bidir/*" "vae-5b/*" "scheduler-5b/*" "umt5/*" "vision-encoder/*"
if errorlevel 1 exit /b 1

echo.
echo === running the shipped example: 5B bidirectional, 720p ===
pushd "%ROOT%"
"%VENV%\Scripts\python.exe" -m edenlive.scripts.infer --config edenlive\configs\wan22_5b_720p_bidir.yaml
set RC=!errorlevel!
popd
echo.
if !RC! EQU 0 (echo DONE) else (echo FAILED with code !RC!)
exit /b !RC!
