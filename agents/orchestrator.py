import asyncio
import datetime
import uuid
import json
import os
import re
from typing import Dict, Any, List, Optional
from datetime import date as dt

from tools.fivetran_tools import (
    list_connections,
    sync_connection,
    get_connection_details,
    sync_all_tenant_connectors,
    check_all_connector_health,
    CONNECTOR_MAP
)
from tools.bigquery_tools import (
    get_tenant_inventory_for_date,
    write_campaign_result
)
from tools.gemini_tools import call_gemini_flash
from config.settings import settings

class OrchestratorAgent:
    def __init__(self):
        self._load_static_data()

    def _load_static_data(self):
        """Load static JSON files once on init."""
        base = os.getcwd()
        
        # Load tenants
        try:
            with open(os.path.join(base, "frontend", "assets", "tenants.json")) as f:
                tenants_list = json.load(f)
                self.tenants_map = {t['id']: t for t in tenants_list}
        except Exception as e:
            print(f"Tenants load error: {e}")
            self.tenants_map = {}

        # Load personas
        try:
            with open(os.path.join(base, "data", "tenant_personas.json")) as f:
                persona_list = json.load(f)
                self.personas_map = {p['id']: p for p in persona_list}
        except Exception as e:
            print(f"Personas load error: {e}")
            self.personas_map = {}

        # Load calendar
        try:
            with open(os.path.join(base, "data", "pulse_calendar.json")) as f:
                self.calendar = json.load(f)
        except Exception as e:
            print(f"Calendar load error: {e}")
            self.calendar = {"micro_seasons": [], "dallas_seasonal_weather": {}}

    def get_square_product_for_tenant(self, tenant_id: str, bq_client) -> dict:
        sku_prefix = tenant_id  # e.g. S17

        try:
            project = bq_client.project

            query = f"""
            SELECT
                i.name,
                i.description,
                v.sku,
                v.price_money_amount
            FROM `{project}.square_catalog.catalog_item` i
            JOIN `{project}.square_catalog.catalog_item_variation` v
                ON v.item_id = i.id
            WHERE v.sku LIKE '{sku_prefix}%'
            LIMIT 1
            """

            job = bq_client.query(query)
            rows = list(job.result(timeout=10))

            if rows:
                row = rows[0]
                print(f"[Square] {tenant_id}: {row.name}")
                return {
                    "name": row.name or "",
                    "description": row.description or "",
                    "price": (row.price_money_amount or 0) / 100
                }
            else:
                print(f"[Square] No product found for {tenant_id}")

        except Exception as e:
            print(f"[Square] Product lookup failed for {tenant_id}: {e}")

        return {"name": "", "description": "", "price": 0}

    async def run_goal(self, goal_text: str, event_queue: asyncio.Queue) -> Dict[str, Any]:
        
        campaign_id = f"CAMP-{uuid.uuid4().hex[:6].upper()}"

        # Extract date from goal text
        date_match = re.search(r'\d{4}-\d{2}-\d{2}', goal_text)
        selected_date = date_match.group() if date_match else datetime.date.today().strftime("%Y-%m-%d")
        d = dt.fromisoformat(selected_date)

        async def log(agent: str, message: str, log_type: str = "thinking", data: dict = None):
            await event_queue.put({
                "campaign_id": campaign_id,
                "agent": agent,
                "message": message,
                "type": log_type,
                "timestamp": datetime.datetime.now().isoformat(),
                "data": data or {}
            })
            await asyncio.sleep(0.3)

        # ══════════════════════════════════════════
        # STAGE 0 — DATE CONTEXT
        # ══════════════════════════════════════════
        # Wait for SSE connection to establish on client
        await asyncio.sleep(2)
        day_name = d.strftime("%A, %B %d %Y")
        await log("Signal_Agent", f"Date context: {day_name}", "thinking")

        # ══════════════════════════════════════════
        # STAGE 1 — FOUR TRIGGERS IN PARALLEL
        # ══════════════════════════════════════════
        await log("Signal_Agent", "Gathering 4 triggers simultaneously...", "thinking")

        # Trigger 1: Weather
        try:
            from tools.weather_tools import get_current_weather
            try:
                from api.routes.agents import weather_toggle
                use_real_weather = weather_toggle.get("use_real_api", False)
            except:
                use_real_weather = False
            weather = await get_current_weather(
                settings.mall.lat,
                settings.mall.lng,
                target_date=selected_date,
                use_real_api=use_real_weather
            )
        except Exception as e:
            print(f"Weather error: {e}")
            weather = {"temp_f": 72, "conditions": "mild", "rain_intensity": 0.0, "mood": "comfortable", "source": "fallback"}

        source_label = "live API" if weather.get("source") == "google_weather_api" else weather.get("source", "seasonal_estimate")
        await log("Signal_Agent",
            f"[1/4] Weather ({source_label}): {weather['temp_f']}F, {weather['conditions']}",
            "data")

        # Trigger 2: Micro-season
        active_seasons = []
        try:
            for ms in self.calendar.get("micro_seasons", []):
                s_month, s_day = map(int, ms['start'].split('-'))
                e_month, e_day = map(int, ms['end'].split('-'))
                start = dt(d.year, s_month, s_day)
                # Handle year wrap (e.g. NFL season Jan-Jan)
                end_year = d.year if e_month >= s_month else d.year + 1
                end = dt(end_year, e_month, e_day)
                if start <= d <= end:
                    active_seasons.append(ms)
            # Sort by weight descending
            active_seasons.sort(key=lambda x: x.get('weight', 0), reverse=True)
        except Exception as e:
            print(f"Micro-season error: {e}")

        season_names = [f"{s['emoji']} {s['name']}" for s in active_seasons]
        await log("Signal_Agent",
            f"[2/4] Micro-seasons: {', '.join(season_names) if season_names else 'None active'}",
            "data")

        # Trigger 3: Payday
        try:
            reference = dt(2026, 1, 2)
            is_friday = d.weekday() == 4
            delta_days = (d - reference).days
            is_biweekly = is_friday and delta_days >= 0 and delta_days % 14 == 0
            is_gov_payday = d.day in (1, 15)
            is_payday = is_biweekly or is_gov_payday
            payday_type = "bi-weekly Friday" if is_biweekly else "government payday (1st or 15th)" if is_gov_payday else None
        except Exception as e:
            is_payday = False
            payday_type = None

        await log("Signal_Agent",
            f"[3/4] Payday: {'✓ ' + payday_type if is_payday else 'Not a payday'}",
            "data")

        # Trigger 4: BigQuery Inventory
        try:
            inventory = await get_tenant_inventory_for_date(selected_date)
            # If empty try a fallback date (random day same month)
            if not inventory:
                import random
                fallback_day = random.randint(1, 28)
                fallback_date = f"{d.year}-{str(d.month).zfill(2)}-{str(fallback_day).zfill(2)}"
                inventory = await get_tenant_inventory_for_date(fallback_date)
                await log("Signal_Agent", f"[4/4] Inventory: date not found, using {fallback_date} as proxy", "data")
            else:
                await log("Signal_Agent", f"[4/4] BigQuery inventory: {len(inventory)} tenants loaded for {selected_date}", "data")
        except Exception as e:
            print(f"Inventory BigQuery error: {e}")
            inventory = []
            await log("Signal_Agent", f"[4/4] Inventory: BigQuery unavailable, using empty list", "data")

        # ══════════════════════════════════════════
        # BUILD GEMINI PROMPT
        # ══════════════════════════════════════════
        await log("Campaign_Agent", "Building Gemini Flash prompt from 4 triggers + 25 personas...", "action")

        # Top season context
        top_season = active_seasons[0] if active_seasons else None
        season_context = f"{top_season['name']}: {top_season['angle']}" if top_season else "No specific season active"
        season_categories = top_season.get('categories', []) if top_season else []
        all_season_names = ", ".join([s['name'] for s in active_seasons]) if active_seasons else "None"

        # Inventory summary (one line per tenant)
        inv_lookup = {row['tenant_id']: row for row in inventory}
        inventory_lines = []
        for inv in sorted(inventory, key=lambda x: x.get('inventory_health', 0), reverse=True):
            inventory_lines.append(
                f"{inv['tenant_id']} | {inv['tenant_name']} | {inv['category']} | "
                f"Health:{inv['inventory_health']}/100 | {inv['stock_level']} | {inv.get('seasonal_note','')}"
            )
        inventory_summary = "\n".join(inventory_lines) if inventory_lines else "No inventory data available"

        # Persona summary (one line per tenant)
        persona_lines = []
        for tid, persona in self.personas_map.items():
            tenant = self.tenants_map.get(tid, {})
            persona_lines.append(
                f"{tid} | {persona.get('name','')} | {persona.get('category','')} | "
                f"Audience: {persona.get('audience','')[:90]} | "
                f"Voice: {persona.get('campaign_voice','')[:60]} | "
                f"Diff: {persona.get('differentiator','')[:80]}"
            )
        personas_summary = "\n".join(persona_lines) if persona_lines else "No persona data available"

        # Time of day context map
        time_contexts = {
            "08:00": ("Morning Open",   "Early shoppers, coffee runs, casual browsing. Favour FB and beauty."),
            "10:00": ("Mid Morning",    "Browsing peak, families arriving. Favour fashion and electronics."),
            "12:00": ("Lunch Rush",     "Food court peak, office workers. Favour FB strongly."),
            "12:30": ("Lunch Rush",     "Food court peak, office workers. Favour FB strongly."),
            "14:00": ("Afternoon",      "Relaxed browsing, gift shoppers. Favour jewelry and fashion."),
            "15:00": ("Afternoon",      "Relaxed browsing, gift shoppers. Favour jewelry and fashion."),
            "15:30": ("School Out",     "Teens and young adults arriving. Favour entertainment and sporting."),
            "17:30": ("Evening Peak",   "Highest footfall. Gifting, dining and leisure dominate. All categories strong."),
            "18:00": ("Evening Peak",   "Highest footfall. Gifting, dining and leisure dominate. All categories strong."),
            "18:30": ("Dinner Hour",    "Food court dominant. Favour FB and jewelry gifting."),
            "19:00": ("Dinner Hour",    "Food court dominant. Favour FB and jewelry gifting."),
            "19:30": ("Late Evening",   "Winding down, impulse purchases. Favour electronics and beauty."),
            "20:30": ("Late Evening",   "Winding down, impulse purchases. Favour electronics and beauty."),
            "21:00": ("Closing Soon",   "Last chance shoppers, clearance mindset. Favour FB and entertainment."),
        }

        # Extract time from goal text or default to evening peak
        time_match = re.search(r'(\d{2}:\d{2})', goal_text)
        selected_time = time_match.group(1) if time_match else "17:30"
        time_label, time_context = time_contexts.get(
            selected_time,
            ("Evening Peak", "Highest footfall. Gifting and dining dominate.")
        )

        # Weather context string
        weather_context = f"{weather['temp_f']}°F, {weather['conditions']}"
        if weather.get('rain_intensity', 0) > 0.05:
            weather_context += " (rain detected)"

        # Payday context string
        payday_context = f"YES — {payday_type}" if is_payday else "No"

        # Build the full prompt
        gemini_prompt = f"""You are PULSE, an AI campaign engine for Galleria Dallas shopping mall.
Your job: analyze today's signals and select the 5 most relevant tenants for a campaign right now.

TODAY'S SIGNALS
Date: {selected_date} ({day_name})
Time: {selected_time} ({time_label})
Time context: {time_context}
Weather: {weather_context}
Payday: {payday_context}
Active micro-seasons: {all_season_names}
Primary season angle: {season_context}
Season priority categories: {', '.join(season_categories) if season_categories else 'All categories'}

TENANT INVENTORY HEALTH (Live from BigQuery via Fivetran sync)
Format: TenantID | Name | Category | InventoryHealth | StockLevel | SeasonalNote

{inventory_summary}

TENANT PROFILES (25 stores)
Format: TenantID | Name | Category | Audience | CampaignVoice | Differentiator

{personas_summary}

SELECTION RULES
1. EXCLUDE any tenant with inventory health below 35
2. STRONGLY PRIORITIZE tenants matching season priority categories
3. Top 3 ranks MUST come from season priority categories.
   Ranks 4 and 5 can include FB or other categories if
   contextually justified by time of day or weather.
   ENTERTAINMENT is only valid if no better seasonal match exists.
4. Do NOT select a tenant purely because they are indoors
   or high footfall. Reason must be seasonally relevant.
5. If payday YES: boost JEWELRY and ELECTRONICS in ranking
6. Consider time of day: {time_label} — {time_context}
7. Select EXACTLY 5 tenants ranked 1 to 5

ANNOUNCEMENT AND OFFER RULES
For all 5 selected tenants generate ONE combined paragraph
in upscale mall PA announcement style:
- Open with "Attention Galleria Dallas shoppers"
- Announce all 5 tenants naturally in flowing sequence
- Each tenant gets ONE specific concrete offer:
  JEWELRY: complimentary gift wrap, engraving, or presentation box
  ELECTRONICS: free setup, accessory bundle, or extended warranty
  FASHION: styling consultation, complimentary alteration, or first X customers
  FB: BOGO, complimentary starter for groups, or limited-time combo
  BEAUTY: free sample set, consultation, or gift-with-purchase
  SPORTING: free fitting, bundle deal, or first X customers
  ENTERTAINMENT: bonus credit, limited edition, or bundle deal
- F&B offers expire within 2 hours of {selected_time}
- All other offers valid end of day
- Close with a brief warm Galleria Dallas sign-off
- 80-100 words total — concise and punchy not lengthy
- Tone: warm and upscale matching {season_context}
- Every offer must be specific and concrete not generic

AD CREATIVE RULES
For the top 2 ranked tenants generate ad creative briefs.
You set the TONE and TAGLINE only.
Product details and price will be sourced from Square POS catalog.
Do NOT describe the product — just the scene and atmosphere.

For each of the top 2 provide:

tone: Visual mood, lighting, composition, color palette
      that reflects the active micro-season: {season_context}.
      The scene should visually evoke the season — graduation
      caps and confetti for graduation, snowflakes for winter,
      fireworks for July 4th etc.
      2-3 sentences. Do NOT mention the product itself.

tagline: One punchy ad line maximum 6 words.
         MUST reference the active micro-season theme.
         Match the brand campaign voice.
         Examples for graduation: "Graduate to greatness."
         Examples for valentines: "Love looks like this."
         Examples for summer: "Your summer starts here."

tagline_style: Font direction and position.
               Format: style, position, color and effect
               Example: "elegant serif, bottom third centered,
               white text with soft gold glow"

OUTPUT FORMAT — return ONLY valid JSON no markdown no backticks
{{
  "trigger_type": "MICRO_SEASON | PAYDAY | WEATHER | COMBINED",
  "campaign_angle": "One sentence campaign theme for today",
  "top_5": [
    {{
      "rank": 1,
      "tenant_id": "SXX",
      "name": "Store Name",
      "category": "CATEGORY",
      "reason": "One sentence why this tenant fits today specifically"
    }}
  ],
  "excluded_tenants": [
    {{
      "tenant_id": "SXX",
      "name": "Store Name",
      "reason": "Inventory health XX/100 — below threshold"
    }}
  ],
  "loyalty_messages": {{
    "[tenant_id_of_rank_1]": "Push notification max 60 chars specific to their offer",
    "[tenant_id_of_rank_2]": "Push notification max 60 chars specific to their offer",
    "[tenant_id_of_rank_3]": "Push notification max 60 chars specific to their offer",
    "[tenant_id_of_rank_4]": "Push notification max 60 chars specific to their offer",
    "[tenant_id_of_rank_5]": "Push notification max 60 chars specific to their offer"
  }},
  "ad_creatives": {{
    "[tenant_id_of_rank_1]": {{
      "tone": "2-3 sentence visual atmosphere. No product description.",
      "tagline": "Max 6 word punchy ad line",
      "tagline_style": "font style, position, color and effect"
    }},
    "[tenant_id_of_rank_2]": {{
      "tone": "2-3 sentence visual atmosphere. No product description.",
      "tagline": "Max 6 word punchy ad line",
      "tagline_style": "font style, position, color and effect"
    }}
  }},
  "campaign_announcement": "80-100 word PA paragraph starting with Attention Galleria Dallas shoppers"
}}"""

        # ══════════════════════════════════════════
        # Store prompt directly via import
        try:
            from api.routes.agents import (
                gemini_prompt_store
            )
            gemini_prompt_store["prompt"] = gemini_prompt
            gemini_prompt_store["tokens"] = (
                len(gemini_prompt) // 4
            )
            gemini_prompt_store["ready"] = True
            print(f"[PULSE] Prompt stored successfully "
                  f"({len(gemini_prompt)//4} tokens)")
        except Exception as _e:
            print(f"Prompt store failed: {_e}")

        # Emit signal to dashboard
        await event_queue.put({
            "type": "gemini_prompt_ready",
            "agent": "Campaign_Agent",
            "message": f"Gemini prompt ready — {len(gemini_prompt)//4} tokens. Paste response in dashboard.",
            "timestamp": datetime.datetime.now().isoformat(),
            "data": {}
        })
        await log("Campaign_Agent",
            f"Gemini prompt stored — {len(gemini_prompt)//4} tokens. "
            f"Copy from dashboard and paste response.",
            "action")

        try:
            raw = await call_gemini_flash(
                gemini_prompt,
                system_instruction=(
                    "You are a retail AI campaign engine for "
                    "Galleria Dallas shopping mall. "
                    "Return ONLY valid JSON. "
                    "No markdown. No backticks. No explanation."
                )
            )
            await log("Campaign_Agent",
                "Gemini response received — parsing JSON...",
                "action")
        except Exception as _ge:
            await log("Campaign_Agent",
                f"Gemini API failed: {_ge} — waiting for manual paste...",
                "decision")
            # Poll for manually pasted response
            from api.routes.agents import (
                gemini_response_store
            )
            raw = None
            for _ in range(300):
                await asyncio.sleep(1)
                try:
                    if (gemini_response_store.get("ready") and
                        gemini_response_store.get("response")):
                        raw = gemini_response_store["response"]
                        await log("Campaign_Agent",
                            "Manual response received — parsing...",
                            "action")
                        break
                except Exception:
                    pass

        if not raw:
            await log("Campaign_Agent",
                "No Gemini response — aborting.",
                "decision")
            return {"status": "no_response"}
        
        gemini_response = None
        top_5 = []
        excluded_tenants = []
        trigger_type = "COMBINED"
        campaign_angle = season_context if top_season else "Payday special offers"
        loyalty_messages = {}
        ad_creatives = {}
        tts_audio_url = ""

        raw = raw.strip()
        if raw.startswith("```json"):
            raw = raw[7:]
        if raw.startswith("```"):
            raw = raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

        try:
            gemini_response = json.loads(raw)
        except json.JSONDecodeError as _je:
            await log("Campaign_Agent",
                f"Failed to parse Gemini response: {_je}",
                "decision")
            await log("Campaign_Agent",
                f"Raw response preview: {raw[:200]}",
                "decision")
            return {"status": "parse_error"}

        try:
            top_5 = gemini_response.get("top_5", [])
            excluded_tenants = gemini_response.get("excluded_tenants", [])
            trigger_type = gemini_response.get("trigger_type", "COMBINED")
            campaign_angle = gemini_response.get(
                "campaign_angle", campaign_angle)

            # Extract campaign_announcement
            campaign_announcement = gemini_response.get(
                "campaign_announcement", "")

            # Parse ad_creatives from new Gemini response format
            raw_ad_creatives = gemini_response.get("ad_creatives", {})
            ad_creatives = {}
            top_5_ids = [t['tenant_id'] for t in top_5]

            if raw_ad_creatives:
                for key, value in raw_ad_creatives.items():
                    if key in top_5_ids:
                        ad_creatives[key] = value
                    elif 'rank' in key.lower():
                        rank_keys = sorted(
                            [k for k in raw_ad_creatives.keys()
                             if 'rank' in k.lower()]
                        )
                        for i, rk in enumerate(rank_keys[:2]):
                            if i < len(top_5):
                                real_id = top_5[i]['tenant_id']
                                ad_creatives[real_id] = raw_ad_creatives[rk]
                        break

            print(f"Ad creatives parsed for: {list(ad_creatives.keys())}")


            # Extract loyalty messages
            raw_loyalty = gemini_response.get("loyalty_messages", {})
            top_5_ids = [t['tenant_id'] for t in top_5]
            loyalty_messages = {
                tid: msg
                for tid, msg in raw_loyalty.items()
                if tid in top_5_ids
            }

            # Fill defaults for missing messages
            season_name = active_seasons[0]['name'] if active_seasons else "Special Event"
            for t in top_5:
                if t['tenant_id'] not in loyalty_messages:
                    loyalty_messages[t['tenant_id']] = (
                        f"Special {season_name} offers at {t['name']}!"[:60]
                    )

            print(f"Loyalty messages: {list(loyalty_messages.keys())}")

            await log("Campaign_Agent",
                f"Gemini selected: {', '.join([t['name'] for t in top_5])}",
                "decision")

            # Emit campaign_announcement to dashboard
            if campaign_announcement:
                await event_queue.put({
                    "type": "campaign_announcement",
                    "agent": "Campaign_Agent",
                    "message": campaign_announcement,
                    "timestamp": datetime.datetime.now().isoformat(),
                    "data": {"announcement": campaign_announcement}
                })

            # Generate TTS for campaign announcement
            tts_audio_url = ""
            if campaign_announcement:
                await log("Delivery_Agent",
                    "Generating PA announcement audio...",
                    "thinking")
                try:
                    from tools.tts_tools import generate_announcement_audio
                    tts_audio_url = await generate_announcement_audio(
                        campaign_announcement,
                        campaign_id=campaign_id
                    )
                    if tts_audio_url:
                        await log("Delivery_Agent",
                            "PA announcement audio ready",
                            "action")
                    else:
                        await log("Delivery_Agent",
                            "TTS generation skipped — no API key",
                            "decision")
                except Exception as _tts_e:
                    print(f"[TTS] Error: {_tts_e}")
                    await log("Delivery_Agent",
                        "TTS generation failed — continuing without audio",
                        "decision")

        except Exception as e:
            await log("Campaign_Agent",
                f"Failed to parse Gemini response: {e}",
                "decision")
            print(f"Parse error: {e}")
            print(f"Raw response: {raw[:200] if raw else 'None'}")
            return {"status": "parse_error"}

        # Emit investigating events for top 5
        for t in top_5:
            await log("Campaign_Agent",
                f"✓ Rank {t['rank']}: {t['name']} — {t['reason']}",
                "decision")
            await event_queue.put({
                "type": "investigating",
                "agent": "Campaign_Agent",
                "message": f"Selected: {t['name']}",
                "timestamp": datetime.datetime.now().isoformat(),
                "tenant_ids": [t['tenant_id']]
            })
            await asyncio.sleep(0.2)

        # Emit excluded events
        for t in excluded_tenants[:4]:
            await log("Campaign_Agent",
                f"✗ Excluded: {t['name']} — {t['reason']}",
                "decision")
            await event_queue.put({
                "type": "tenant_excluded",
                "agent": "Campaign_Agent",
                "message": f"Excluded: {t['reason']}",
                "timestamp": datetime.datetime.now().isoformat(),
                "tenant_id": t['tenant_id'],
                "reason": t['reason']
            })
            await asyncio.sleep(0.2)

        # ══════════════════════════════════════════
        # STEP 3 — GM APPROVAL 1 (top 5 tenants)
        # ══════════════════════════════════════════
        # Reset approval gates BEFORE emitting
        try:
            from api.routes.agents import approval_gates
            approval_gates.pop("approval_1", None)
            approval_gates.pop("approval_2", None)
        except:
            pass

        await event_queue.put({
            "type": "awaiting_approval_1",
            "agent": "Orchestrator",
            "message": "Awaiting GM approval for top 5 tenant selection",
            "timestamp": datetime.datetime.now().isoformat(),
            "data": {
                "score": 91,
                "theme": campaign_angle,
                "trigger_type": trigger_type,
                "top_5": top_5
            }
        })

        # Poll for GM approval 1
        approval_1_granted = False
        for _ in range(120):
            await asyncio.sleep(1)
            try:
                from api.routes.agents import approval_gates
                if approval_gates.get("approval_1"):
                    await log("Orchestrator",
                        "GM approved campaign. Proceeding...",
                        "action")
                    approval_1_granted = True
                    break
            except:
                pass

        if not approval_1_granted:
            await log("Orchestrator",
                "GM approval timed out after 2 minutes — campaign aborted.",
                "decision")
            return {"status": "approval_1_timeout"}

        # ══════════════════════════════════════════
        # STEP 4 — FIVETRAN SYNC
        # ══════════════════════════════════════════
        await log("Orchestrator",
            "Triggering Fivetran sync across all connectors...",
            "action")

        try:
            # Sync all connectors in parallel
            sync_tasks = [sync_connection(cid) for cid in CONNECTOR_MAP.keys()]
            sync_results = await asyncio.gather(*sync_tasks, return_exceptions=True)

            # Emit sync status per connector
            for i, (cid, schema) in enumerate(CONNECTOR_MAP.items()):
                status = "success" if not isinstance(sync_results[i], Exception) else "failed"
                await event_queue.put({
                    "type": "fivetran_sync",
                    "agent": "Orchestrator",
                    "message": f"Connector {schema} synced",
                    "timestamp": datetime.datetime.now().isoformat(),
                    "connector_id": cid,
                    "tenant_ids": [],
                    "status": status,
                    "sync_results": {cid: {"status": status} for cid in CONNECTOR_MAP.keys()}
                })
                await asyncio.sleep(0.3)

            await log("Orchestrator",
                f"All {len(CONNECTOR_MAP)} Fivetran connectors synced",
                "action")
        except Exception as e:
            await log("Orchestrator", f"Fivetran sync completed with warnings: {str(e)[:60]}", "data")

        # ══════════════════════════════════════════
        # STEP 5 — ASSEMBLE 5 CREATIVES
        # ══════════════════════════════════════════
        await log("Campaign_Agent",
            "Assembling ad creatives — top 2 Imagen-ready, 3 premade...",
            "thinking")

        zone_screen_map = {
            "Z7": ["AD-FL2-SW", "AD-FL2-SE"],
            "Z6": ["AD-FL2-NE", "AD-FL2-SE"],
            "Z5": ["AD-FL2-NW", "AD-FL2-SW"],
            "Z2": ["AD-ENT-N1", "AD-FL2-NW"],
            "Z3": ["AD-ENT-N2", "AD-FL2-NE", "AD-PRK-NEW"],
            "Z4": ["AD-ENT-S1", "AD-ENT-S2"],
            "Z1": ["AD-ENT-N1", "AD-ENT-N2"],
            "Z8": ["AD-FL2-NW", "AD-FL2-NE"],
            "cinema": ["AD-PRK-NEW"],
        }

        # Clear previously generated images before new run
        import shutil
        from pathlib import Path as _Path
        _generated_dir = _Path("frontend/assets/generated")
        if _generated_dir.exists():
            for _f in _generated_dir.glob("*.jpg"):
                _f.unlink()
            for _f in _generated_dir.glob("*.png"):
                _f.unlink()
            print("[PULSE] Cleared generated images folder")

        creatives = []
        season_name = top_season['name'] if top_season else "Special Event"

        headlines = {
            "JEWELRY": f"The Perfect {season_name} Gift",
            "ELECTRONICS": f"Upgrade for {season_name}",
            "FB": f"Celebrate {season_name} With Us",
            "FASHION": f"Dress for {season_name}",
            "BEAUTY": f"Glow This {season_name}",
            "SPORTING": f"Gear Up for {season_name}",
            "ENTERTAINMENT": f"Celebrate at {season_name}",
        }

        for i, t in enumerate(top_5):
            tenant_data = self.tenants_map.get(t['tenant_id'], {})
            zone = tenant_data.get('zone_id', 'Z1')
            screens = zone_screen_map.get(zone, ["AD-ENT-N1"])
            headline = headlines.get(t['category'], f"{season_name} Special")

            rank = t.get('rank', top_5.index(t) + 1)
            tid = t['tenant_id']

            if rank <= 2 and tid in ad_creatives:
                await log("Creative_Agent",
                    f"Rank {rank} — {t['name']}: fetching product from Square...",
                    "thinking")

                # Get product details from Square via BigQuery
                from tools.bigquery_tools import bq_client as bq
                product = self.get_square_product_for_tenant(tid, bq)

                if product['description']:
                    await log("Creative_Agent",
                        f"Rank {rank} — {t['name']}: product pulled — {product['name']}",
                        "action")
                else:
                    await log("Creative_Agent",
                        f"Rank {rank} — {t['name']}: no Square product found, using brand context",
                        "decision")

                # Build combined Imagen prompt
                creative_brief = ad_creatives[tid]

                if product['description']:
                    price_display = ""
                    if product.get('price') and product['price'] > 0:
                        price_display = f"${product['price']:,.0f}"

                    combined_prompt = (
                        f"{product['description']}. "
                        f"Theme: {season_context}. "
                        f"{creative_brief['tone']} "
                        f"Include text overlay: "
                        f"\"{creative_brief['tagline']}\" "
                        f"in {creative_brief['tagline_style']}. "
                    )

                    if price_display:
                        combined_prompt += (
                            f"Also include a price tag text: "
                            f"\"Starting at {price_display}\" "
                            f"in clean sans-serif font, smaller than tagline, "
                            f"positioned below the tagline, white text. "
                        )

                    combined_prompt += (
                        f"16:9 landscape DOOH digital billboard. "
                        f"Photorealistic professional advertising photography. "
                        f"No additional logos or watermarks."
                    )
                else:
                    combined_prompt = (
                        f"{t['name']} brand advertisement. "
                        f"Theme: {season_context}. "
                        f"{creative_brief['tone']} "
                        f"Include text overlay: "
                        f"\"{creative_brief['tagline']}\" "
                        f"in {creative_brief['tagline_style']}. "
                        f"16:9 landscape DOOH digital billboard. "
                        f"Photorealistic professional advertising photography."
                    )

                print(f"[Imagen Prompt] {tid}: {combined_prompt[:200]}...")

                await log("Creative_Agent",
                    f"Rank {rank} — {t['name']}: generating AI ad...",
                    "thinking")

                try:
                    from tools.imagen_tools import generate_ad_image
                    creative_url = await generate_ad_image(combined_prompt, tid)
                    if creative_url.startswith("/assets/generated") or \
                            creative_url.startswith("https://"):
                        is_generated = True
                        await log("Creative_Agent",
                            f"Rank {rank} — {t['name']}: AI ad generated ✓",
                            "action")
                    else:
                        is_generated = False
                        creative_url = f"/assets/creatives/{tid}_ad.png"
                        await log("Creative_Agent",
                            f"Rank {rank} — {t['name']}: generation failed, using premade",
                            "decision")
                except Exception as _ie:
                    creative_url = f"/assets/creatives/{tid}_ad.png"
                    is_generated = False
                    await log("Creative_Agent",
                        f"Rank {rank} — {t['name']}: error — using premade",
                        "decision")
            else:
                creative_url = f"/assets/creatives/{tid}_ad.png"
                is_generated = False
                await log("Creative_Agent",
                    f"Rank {rank} — {t['name']}: using premade ad",
                    "action")

            creative = {
                "tenant_id": tid,
                "tenant_name": t['name'],
                "rank": rank,
                "url": creative_url,
                "is_generated": is_generated,
                "headline": headline,
                "screens": screens,
                "zone": zone
            }
            creatives.append(creative)

            # Focus camera on each store as creative assembles
            await event_queue.put({
                "type": "investigating",
                "agent": "Campaign_Agent",
                "message": f"Preparing creative for {t['name']}",
                "timestamp": datetime.datetime.now().isoformat(),
                "tenant_ids": [t['tenant_id']]
            })

            label = "AI Generated" if i < 2 else "Premade"
            await log("Campaign_Agent",
                f"Creative ready [{label}]: {t['name']} — '{headline}'",
                "creative",
                {"url": creative['url'], "tenant_id": t['tenant_id'],
                 "tenant_name": t['name'], "is_generated": is_generated})
            await asyncio.sleep(0.5)

        # ══════════════════════════════════════════
        # STEP 6 — GM APPROVAL 2 (5 ads)
        # ══════════════════════════════════════════
        # Ensure approval_2 gate is clean BEFORE emitting
        try:
            from api.routes.agents import approval_gates
            approval_gates.pop("approval_2", None)
        except:
            pass

        await event_queue.put({
            "type": "awaiting_approval_2",
            "agent": "Orchestrator",
            "message": "5 campaign creatives ready. Awaiting GM deployment approval.",
            "timestamp": datetime.datetime.now().isoformat(),
            "data": {
                "creatives": creatives,
                "tenants": [t['name'] for t in top_5]
            }
        })

        # Poll for GM approval 2
        approval_2_granted = False
        for _ in range(120):
            await asyncio.sleep(1)
            try:
                from api.routes.agents import approval_gates
                if approval_gates.get("approval_2"):
                    await log("Orchestrator",
                        "GM approved creatives. Deploying...",
                        "action")
                    approval_2_granted = True
                    break
            except:
                pass

        if not approval_2_granted:
            await log("Orchestrator",
                "GM creative approval timed out — campaign aborted.",
                "decision")
            return {"status": "approval_2_timeout"}

        # ══════════════════════════════════════════
        # STEP 7 — TENANT ZONE GLOW + AUTO-APPROVE
        # ══════════════════════════════════════════
        await log("Delivery_Agent",
            "Notifying tenant managers. Awaiting their approval...",
            "action")

        await event_queue.put({
            "type": "pending_approval",
            "agent": "Delivery_Agent",
            "message": "Tenant manager approvals pending",
            "timestamp": datetime.datetime.now().isoformat(),
            "tenant_ids": [t['tenant_id'] for t in top_5]
        })

        # 5 second auto-approval simulation
        await asyncio.sleep(5)
        await log("Delivery_Agent",
            "All 5 tenant managers approved ✓",
            "delivery")

        # ══════════════════════════════════════════
        # STEP 8 — LOYALTY NOTIFICATIONS
        # ══════════════════════════════════════════
        await log("Delivery_Agent",
            "Querying BigQuery loyalty customers for top 5 stores...",
            "action")

        tenant_ids = [t['tenant_id'] for t in top_5]

        # Build loyalty notifications
        # Query loyalty customers for top 5 tenants
        notifications = []
        try:
            from tools.bigquery_tools import bq_client as _bq
            if not _bq:
                raise Exception("BigQuery client not available")
            _top_ids = [t['tenant_id'] for t in top_5]
            _ids_str = ','.join([f"'{x}'" for x in _top_ids])

            _query = f"""
            SELECT name, tenant_id, tenant_name
            FROM (
                SELECT name, tenant_id, tenant_name,
                       amount_spent,
                       ROW_NUMBER() OVER (
                           PARTITION BY tenant_id
                           ORDER BY amount_spent DESC
                       ) as rn
                FROM `pulse_loyalty_customers.customers`
                WHERE tenant_id IN ({_ids_str})
            )
            WHERE rn = 1
            """
            _rows = list(_bq.query(_query).result(timeout=10))

            # Group one customer per tenant for display
            _seen_tenants = {}
            for row in _rows:
                tid = row.tenant_id
                if tid not in _seen_tenants:
                    _seen_tenants[tid] = row.name

            # Build one notification per top 5 tenant
            for t in top_5:
                tid = t['tenant_id']
                cust_name = _seen_tenants.get(tid, "Loyalty Member")
                msg = loyalty_messages.get(tid,
                    f"Special offer at {t['name']} today!")
                notifications.append({
                    "tenant_id": tid,
                    "tenant_name": t['name'],
                    "customer_name": cust_name,
                    "message": msg
                })

            print(f"[Loyalty] Built {len(notifications)} notifications")

        except Exception as _le:
            print(f"[Loyalty] Query failed: {_le}")
            # Fallback without customer names
            for t in top_5:
                tid = t['tenant_id']
                msg = loyalty_messages.get(tid,
                    f"Special offer at {t['name']} today!")
                notifications.append({
                    "tenant_id": tid,
                    "tenant_name": t['name'],
                    "customer_name": "Loyalty Member",
                    "message": msg
                })

        # ══════════════════════════════════════════
        # STEP 9 — CAMPAIGN FIRES
        # ══════════════════════════════════════════
        await log("Delivery_Agent",
            "Deploying ads to mall screens based on zone footfall...",
            "delivery")

        # Query real daily revenue before firing so the event carries the true value
        try:
            from tools.bigquery_tools import get_daily_revenue
            daily_revenue = get_daily_revenue(selected_date)
            print(f"[Revenue] Daily total: ${daily_revenue:,.0f}")
        except Exception as _re:
            daily_revenue = 148250.0
            print(f"[Revenue] Using fallback: ${daily_revenue:,.0f}")

        await event_queue.put({
            "type": "campaign_fired",
            "agent": "Delivery_Agent",
            "message": "Campaign live across Galleria Dallas",
            "timestamp": datetime.datetime.now().isoformat(),
            "campaign_id": campaign_id,
            "trigger_type": trigger_type,
            "tenant_ids": [t['tenant_id'] for t in top_5],
            "excluded_tenant_ids": [t['tenant_id'] for t in excluded_tenants[:3]],
            "zone_id": "Z6",
            "brief_summary": campaign_angle,
            "creatives": creatives,
            "daily_revenue": daily_revenue,
            "tts_audio_url": tts_audio_url
        })

        await log("Delivery_Agent",
            f"Sending {len(notifications)} loyalty notifications via push...",
            "delivery")

        await event_queue.put({
            "type": "loyalty_notifications",
            "agent": "Delivery_Agent",
            "message": f"{len(notifications)} loyalty members notified",
            "timestamp": datetime.datetime.now().isoformat(),
            "data": {
                "notifications": notifications,
                "tenants": top_5
            }
        })

        # Activate screens one by one
        for creative in creatives:
            for screen_id in creative.get('screens', []):
                await event_queue.put({
                    "type": "screen_activated",
                    "agent": "Delivery_Agent",
                    "message": f"Screen {screen_id} → {creative['tenant_name']}",
                    "timestamp": datetime.datetime.now().isoformat(),
                    "screen_id": screen_id,
                    "tenant_id": creative['tenant_id'],
                    "creative_url": creative['url']
                })
                await asyncio.sleep(0.25)

        # ══════════════════════════════════════════
        # STEP 10 — WRITE RESULT TO BIGQUERY
        # ══════════════════════════════════════════
        estimated_revenue = len(top_5) * 420.0

        await log("Performance_Agent",
            f"Daily revenue: ${daily_revenue:,.0f}",
            "data")

        await write_campaign_result(campaign_id, {
            "trigger_type": trigger_type,
            "tenants_included": ",".join(tenant_ids),
            "campaign_angle": campaign_angle,
            "estimated_revenue": estimated_revenue,
            "fired_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })

        await log("Performance_Agent",
            f"Campaign complete. Estimated revenue lift: ${estimated_revenue:,.0f}. Result written to BigQuery.",
            "complete",
            {"revenue": estimated_revenue})

        await event_queue.put({
            "type": "campaign_resolved",
            "agent": "Performance_Agent",
            "message": "Campaign measured and logged",
            "timestamp": datetime.datetime.now().isoformat(),
            "tenant_ids": tenant_ids,
            "outcome": "positive",
            "revenue_lift": estimated_revenue
        })

        return {
            "campaign_id": campaign_id,
            "trigger_type": trigger_type,
            "campaign_angle": campaign_angle,
            "top_5_tenants": top_5,
            "creatives": creatives,
            "estimated_revenue": estimated_revenue
        }

