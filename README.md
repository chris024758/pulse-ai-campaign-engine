# PULSE (Predictive Unified Live Signal Engine)

PULSE is a real-time AI campaign trigger engine for American shopping malls, built for the Google Cloud RapidAgent Hackathon 2026 on the Fivetran MCP partner track. By fusing live signal monitors with cross-tenant point-of-sale data synced instantly to Google BigQuery, PULSE generates contextually relevant advertising campaigns on digital billboards, mobile push, and store notifications dynamically using Gemini 2.5 and Imagen 3.

## Architecture

```text
                        ┌────────────────────────────────────────────────────────┐
                        │                     PULSE SYSTEM                       │
                        └───────────────────────────┬────────────────────────────┘
                                                    │
             ┌──────────────────────┬───────────────┼───────────────┬──────────────────────┐
             │                      │               │               │                      │
             ▼                      ▼               ▼               ▼                      ▼
    ┌─────────────────┐    ┌─────────────────┐ ┌─────────┐   ┌─────────────┐       ┌───────────────┐
    │ Weather Poller  │    │  Google Trends  │ │ IoT GPS │   │   Events    │       │ Cross-Tenant  │
    │ (Rain/Cold/Hot) │    │  (Topic Spikes) │ │ Sensors │   │ (Concerts)  │       │   POS Data    │
    └────────┬────────┘    └────────┬────────┘ └────┬────┘   └──────┬──────┘       └───────┬───────┘
             │                      │               │               │                      │
             └──────────────────────┼───────────────┴───────────────┘                      │
                                    ▼                                                      ▼
                       ┌─────────────────────────┐                            ┌────────────┴───────────┐
                       │      Signal Agent       │                            │ Fivetran MCP Connector │
                       └────────────┬────────────┘                            └────────────┬───────────┘
                                    │                                                      │
                                    │ (Trigger Event)                                      │ (Real-Time Sync)
                                    ▼                                                      ▼
                       ┌─────────────────────────┐                            ┌────────────────────────┐
                       │    Orchestrator Agent   │◄───────────────────────────┤  Google BigQuery Lake  │
                       └────────────┬────────────┘     (Unified Analytics)    └────────────────────────┘
                                    │
             ┌──────────────────────┼──────────────────────┐
             ▼                      ▼                      ▼
┌────────────────────────┐ ┌──────────────────┐ ┌────────────────────────┐
│     Campaign Agent     │ │  Delivery Agent  │ │   Performance Agent    │
│  (Gemini + Imagen Ad)  │ │ (FCM / Signage)  │ │ (Outcome Measurement)  │
└────────────────────────┘ └──────────────────┘ └────────────────────────┘
```

## Tech Stack

![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)
![Google Cloud BigQuery](https://img.shields.io/badge/Google_Cloud_BigQuery-4285F4?style=for-the-badge&logo=google-cloud)
![Gemini AI](https://img.shields.io/badge/Gemini_AI-8E75C2?style=for-the-badge&logo=google-gemini)
![Fivetran](https://img.shields.io/badge/Fivetran-0062FF?style=for-the-badge&logo=fivetran)
![BabylonJS](https://img.shields.io/badge/BabylonJS-BB464B?style=for-the-badge&logo=babylonjs)

---

## Quick Start

### 1. Clone & Set Environment
Clone the repository and copy the environment template:
```bash
cp .env.example .env
```
Update `.env` with your API keys (Gemini, Fivetran, Google Maps, Firebase etc.). If no cloud credentials are provided, PULSE automatically engages a **Local Data Engine** fallback utilizing pandas and local generated mock datasets.

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Generate Synthetic Data
Priming the dataset is required for the offline POS APIs and localized BigQuery fallback engine:
```bash
python scripts/generate_synthetic_csvs.py
```

### 4. Build Dataset Schema
Run the setup script to check fallbacks or create BigQuery tables:
```bash
python scripts/setup_bigquery.py
```

### 5. Launch Services
Run the Mock POS server simulating real APIs on port 5001:
```bash
python mock_pos/server.py
```
In a separate terminal, launch the FastAPI gateway on port 8080:
```bash
uvicorn api.main:app --port 8080 --reload
```

Open `http://localhost:8080` in your browser to view the Live Command Center!

---

## Fivetran MCP Integration
Fivetran tool wrappers reside inside `tools/fivetran_tools.py` and are invoked programmatically by agents:
1. `list_connectors()` queries connectors associated with the `FIVETRAN_GROUP_ID`.
2. `trigger_sync(connector_id)` forces real-time imports on triggers.
3. `update_sync_frequency()` dynamically dials up sync speeds to 5-minute intervals when local mall footfall anomalies occur.

## BigQuery Analytics
Queries are contained inside `tools/bigquery_tools.py` and analyze:
- Tenant store inventory availability before launching campaigns.
- Historic transaction lift correlation curves.
- Zone footfall sensor density anomalies.


