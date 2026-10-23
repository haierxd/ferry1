"""Real paid-model smoke test through the exact same-origin proxy used by the UI."""
import argparse
from uuid import uuid4

import httpx


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:4173')
    args = parser.parse_args()
    session_id = 'smoke-' + uuid4().hex
    code = '联调-' + uuid4().hex[:10]
    with httpx.Client(base_url=args.base_url, timeout=120) as client:
        config = client.get('/api/config')
        config.raise_for_status()
        config = config.json()
        if not config.get('configured'):
            raise SystemExit('DeepSeek key is empty. Configure personal_agent/.env and restart the backend.')
        def ask(message):
            response = client.post('/api/agents/' + config['agents']['knowledge'] + '/runs', files={
                'message': (None, message), 'user_id': (None, 'smoke-test-user'),
                'session_id': (None, session_id), 'stream': (None, 'false')})
            if response.status_code != 200:
                raise SystemExit(f'Agent request failed: HTTP {response.status_code}. Check backend logs.')
            data = response.json()
            if not data.get('content') or data.get('status', '').upper() != 'COMPLETED':
                raise SystemExit('Agent did not return a completed answer.')
            if data.get('session_id') != session_id:
                raise SystemExit('Agent returned the wrong session.')
            return data
        first = ask(f'请记住本次测试口令：{code}。请只回复“已记住”。')
        second = ask('刚才的测试口令是什么？请只回复完整口令。')
        if code not in second['content']:
            raise SystemExit('Model responded, but the continuity check failed.')
        print('PASS: frontend proxy -> AgentOS -> DeepSeek -> JSON response; two-turn memory verified.')
        print(f'Model: {config["model"]}; session_id: {session_id}')
        print(f'Run IDs: {first.get("run_id")}, {second.get("run_id")}')


if __name__ == '__main__':
    main()
