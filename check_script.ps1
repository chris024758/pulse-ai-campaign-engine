$files = @("frontend/login.html", "scripts/generate_demo_creatives.py", "tools/tts_tools.py", "tools/weather_tools.py", "tools/maps_tools.py", "agents/signal_agent.py", "agents/campaign_agent.py", "agents/delivery_agent.py", "agents/performance_agent.py")
foreach ($f in $files) {
  if (Test-Path $f) {
    $count = (Get-Content $f | Measure-Object -Line).Lines
    Write-Host "$f exists: $count lines"
  } else {
    Write-Host "$f does not exist"
  }
}
Write-Host "--- pip freeze ---"
pip freeze
Write-Host "--- Python Imports ---"
python -c "
import sys
try:
    from api.main import app; print('API imports OK')
except Exception as e:
    import traceback; traceback.print_exc(file=sys.stdout)

try:
    from agents.orchestrator import OrchestratorAgent; print('Orchestrator imports OK')
except Exception as e:
    import traceback; traceback.print_exc(file=sys.stdout)

try:
    from tools.fivetran_tools import list_connections; print('Fivetran tools imports OK')
except Exception as e:
    import traceback; traceback.print_exc(file=sys.stdout)

try:
    from tools.gemini_tools import call_gemini_pro; print('Gemini tools imports OK')
except Exception as e:
    import traceback; traceback.print_exc(file=sys.stdout)

try:
    from tools.imagen_tools import generate_ad_creative; print('Imagen tools imports OK')
except Exception as e:
    import traceback; traceback.print_exc(file=sys.stdout)

try:
    from tools.bigquery_tools import get_tenant_roster; print('BigQuery tools imports OK')
except Exception as e:
    import traceback; traceback.print_exc(file=sys.stdout)
"
