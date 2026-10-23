"""Local AgentOS service. Run with the Python interpreter in this directory's uv venv."""
if not __package__:
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pathlib import Path

from agno.db.sqlite import SqliteDb
from agno.os import AgentOS
from fastapi import Request
from fastapi.responses import JSONResponse

from personal_agent.agent import AGENT_IDS, create_agents
from personal_agent.settings import AGENT_DIR, Settings


def create_app(*, settings: Settings | None = None, db_file: Path | None = None):
    settings = settings or Settings.from_env()
    db_file = Path(db_file) if db_file is not None else AGENT_DIR / 'data' / 'agentos.db'
    db_file.parent.mkdir(parents=True, exist_ok=True)
    db = SqliteDb(db_file=str(db_file), id='zhixu-sessions')
    agent_os = AgentOS(
        id='zhixu-agent-os', name='知序 AI', agents=create_agents(settings, db), db=db,
        cors_allowed_origins=list(settings.cors_origins), telemetry=False,
    )
    app = agent_os.get_app()
    app.state.zhixu_os = agent_os

    @app.middleware('http')
    async def check_model_configuration(request: Request, call_next):
        if (request.method == 'POST' and request.url.path.startswith('/agents/')
                and request.url.path.endswith('/runs') and not settings.api_key):
            return JSONResponse(status_code=503, content={
                'code': 'missing_api_key',
                'detail': '请配置 personal_agent/.env 中的 DEEPSEEK_API_KEY 并重启后端。',
            })
        return await call_next(request)

    @app.get('/web/health', tags=['Web integration'])
    def web_health():
        return {'app': 'zhixu-agent-os', 'status': 'ok', 'configured': bool(settings.api_key)}

    @app.get('/web/config', tags=['Web integration'])
    def web_config():
        return {
            'app': 'zhixu-agent-os', 'configured': bool(settings.api_key),
            'model': settings.model_id, 'agents': AGENT_IDS,
            'knowledge_connected': False,
        }

    return app


app = create_app()

if __name__ == '__main__':
    app.state.zhixu_os.serve(app=app, host='127.0.0.1', port=7777)
