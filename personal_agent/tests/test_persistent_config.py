"""Local credentials are stable across starts, and startup makes no model call."""
from contextlib import redirect_stdout
from io import StringIO
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

from personal_agent.settings import Settings


class PersistentConfigTests(unittest.TestCase):
    def test_saved_file_wins_over_old_terminal_key_and_is_not_rewritten(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / '.env'
            original = 'DEEPSEEK_API_KEY=test-saved-key\nDEEPSEEK_MODEL=deepseek-v4-flash\n'
            env_file.write_text(original, encoding='utf-8-sig')
            with patch('personal_agent.settings.AGENT_DIR', Path(directory)), patch.dict(
                    os.environ, {'DEEPSEEK_API_KEY': 'test-old-terminal-key'}):
                first = Settings.from_env()
                second = Settings.from_env()
            self.assertEqual(first.api_key, 'test-saved-key')
            self.assertEqual(second.api_key, first.api_key)
            self.assertEqual(env_file.read_text(encoding='utf-8-sig'), original)

    def test_environment_remains_a_fallback_when_file_is_unconfigured(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / '.env').write_text('DEEPSEEK_API_KEY=\n', encoding='utf-8')
            with patch('personal_agent.settings.AGENT_DIR', Path(directory)), patch.dict(
                    os.environ, {'DEEPSEEK_API_KEY': 'test-terminal-key'}):
                self.assertEqual(Settings.from_env().api_key, 'test-terminal-key')

    def test_both_agent_entrypoints_do_not_call_deepseek_at_startup(self):
        root = Path(__file__).resolve().parents[2]
        with patch('agno.agent.Agent.print_response', side_effect=AssertionError('Startup must not call a model')):
            for entry in [root / 'personal_agent' / 'agent.py', root / 'agent.py']:
                with self.subTest(entry=entry.name), redirect_stdout(StringIO()):
                    runpy.run_path(str(entry), run_name='__main__')


if __name__ == '__main__':
    unittest.main()
