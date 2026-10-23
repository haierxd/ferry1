"""Exercise real AgentOS dispatch/storage, replacing only the paid model network."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import httpx
from openai import AsyncOpenAI
from agno.models.deepseek import DeepSeek
from fastapi.testclient import TestClient


class AgentOSIntegrationTests(unittest.TestCase):
    def setUp(self):
        from personal_agent.agentos import create_app
        from personal_agent.settings import Settings

        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.requests = []

        def model_reply(request):
            payload = json.loads(request.content)
            self.requests.append(payload)
            return httpx.Response(200, json={
                "id": "chat-test", "object": "chat.completion", "created": 1,
                "model": "deepseek-v4-flash", "choices": [{"index": 0,
                    "message": {"role": "assistant", "content": "已收到：测试代号为紫竹。"},
                    "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20},
            })

        def make_model(**kwargs):
            client = AsyncOpenAI(api_key="test-not-a-real-key", max_retries=0,
                http_client=httpx.AsyncClient(transport=httpx.MockTransport(model_reply)))
            return DeepSeek(**kwargs, async_client=client)

        with patch("personal_agent.agent.DeepSeek", side_effect=make_model):
            app = create_app(settings=Settings(api_key="test-not-a-real-key"),
                db_file=Path(self.temp.name) / "sessions.db")
        self.client = self.enterContext(TestClient(app))

    def run_agent(self, agent_id, question, session="session-a", user="user-a"):
        return self.client.post(f"/agents/{agent_id}/runs", files={
            "message": (None, question), "session_id": (None, session),
            "user_id": (None, user), "stream": (None, "false"),
        })

    def test_three_frontend_roles_are_registered_and_return_native_content(self):
        config = self.client.get('/web/config').json()
        self.assertEqual(set(config['agents']), {'knowledge', 'product', 'service'})
        self.assertNotIn('api_key', config)
        self.assertTrue(config['configured'])
        for role, agent_id in config['agents'].items():
            with self.subTest(role=role):
                result = self.run_agent(agent_id, '你好', session=f'test-{role}')
                self.assertEqual(result.status_code, 200, result.text)
                self.assertIn('紫竹', result.json()['content'])
                self.assertEqual(result.json()['session_id'], f'test-{role}')
                self.assertEqual(result.json()['user_id'], 'user-a')

    def test_second_run_receives_first_turn_but_new_session_does_not(self):
        first = self.run_agent('deepseek-agent', '记住我的测试代号：紫竹。')
        self.assertEqual(first.status_code, 200, first.text)
        second = self.run_agent('deepseek-agent', '刚才的测试代号是什么？')
        self.assertEqual(second.status_code, 200, second.text)
        messages = self.requests[-1]['messages']
        self.assertTrue(any(m['role'] == 'user' and '记住我的测试代号' in str(m['content']) for m in messages))
        self.assertTrue(any(m['role'] == 'assistant' and '紫竹' in str(m['content']) for m in messages))
        third = self.run_agent('deepseek-agent', '新会话', session='session-b')
        self.assertEqual(third.status_code, 200, third.text)
        self.assertFalse(any('记住我的测试代号' in str(m['content']) for m in self.requests[-1]['messages']))

    def test_database_survives_app_recreation(self):
        result = self.run_agent('deepseek-agent', '记住我的测试代号：紫竹。')
        self.assertEqual(result.status_code, 200, result.text)
        from agno.db.sqlite import SqliteDb
        from agno.db.base import SessionType
        db = SqliteDb(db_file=str(Path(self.temp.name) / 'sessions.db'))
        self.addCleanup(db.close)
        session = db.get_session(session_id='session-a', session_type=SessionType.AGENT, user_id='user-a')
        self.assertIsNotNone(session)
        self.assertTrue(session.runs)

    def test_missing_key_is_reported_without_model_call(self):
        from personal_agent.agentos import create_app
        from personal_agent.settings import Settings
        with TestClient(create_app(settings=Settings(api_key=None),
                db_file=Path(self.temp.name) / 'empty.db')) as client:
            self.assertFalse(client.get('/web/config').json()['configured'])
            response = client.post('/agents/deepseek-agent/runs', data={
                'message': '你好', 'stream': 'false', 'user_id': 'u', 'session_id': 's'})
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()['code'], 'missing_api_key')
        self.assertFalse(self.requests)

    def test_docs_and_cors_match_frontend_addresses(self):
        self.assertEqual(self.client.get('/docs').status_code, 200)
        for origin in ['http://127.0.0.1:4173', 'http://localhost:4173', 'http://localhost:3000']:
            response = self.client.options('/agents/deepseek-agent/runs', headers={
                'Origin': origin, 'Access-Control-Request-Method': 'POST'})
            self.assertEqual(response.headers.get('access-control-allow-origin'), origin)


if __name__ == '__main__':
    unittest.main()
