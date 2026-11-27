# Charge Map

React + Vite frontend with a FastAPI backend and a local open-source language model for EV charging-site suitability assessments.

## One-time local model setup

Install Ollama for Windows:

```powershell
winget install --id Ollama.Ollama
```

Open a new PowerShell window, then download the default Qwen 3 1.7B model:

```powershell
ollama pull qwen3:1.7b
```

Ollama must be running locally. The model runs on this computer; no OpenAI key or paid AI API is used. The first assessment may take longer while the model loads. This quantized model needs a few GB of memory.

## Run locally

Install the JavaScript dependencies:

```powershell
npm install
```

Install the Python dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Optionally copy `.env.example` to `.env` to change `OLLAMA_BASE_URL` or `OLLAMA_MODEL`. No API key is needed.

Start the API and frontend in separate terminals from the project directory:

```powershell
python -m uvicorn api.main:app --reload --port 8000
```

```powershell
npm run dev
```

Open the Vite URL shown in the frontend terminal. Vite proxies `/api` requests to FastAPI on port 8000.

## Site suitability assessment

The checker calls `POST /api/site-assessment` and sends the assessment prompt to the local Ollama model. The backend measures nearby stations from `public/chargers.json` when coordinates are supplied. Traffic, population, EV adoption, parking, and grid access are user-provided estimates or marked unavailable. Unknown factors are never presented as measured facts.

The 0–100 output is an AI-generated decision-support score, not a calibrated probability or validated ML prediction. Verify factors locally before making investment decisions.

## Checks

```powershell
npm test
npm run lint
npm run build
python -m pytest
```
