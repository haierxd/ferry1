"""Keep the standalone agent usable independently of the web service."""
import importlib
import unittest

from agno.agent import Agent
from agno.models.deepseek import DeepSeek

from personal_agent.settings import Settings


class AgentDefinitionTests(unittest.TestCase):
    def test_module_exports_a_standalone_deepseek_agent(self):
        module = importlib.import_module('personal_agent.agent')
        self.assertIsInstance(module.agent, Agent)
        self.assertIsInstance(module.agent.model, DeepSeek)
        self.assertTrue(module.agent.markdown)
        self.assertEqual(module.agent.instructions, module.SYSTEM_PROMPT)
        self.assertIsNone(module.agent.db)

    def test_web_agents_reuse_the_prompt_and_keep_separate_instances(self):
        module = importlib.import_module('personal_agent.agent')
        agents = module.create_agents(Settings(api_key='test-not-a-real-key'))
        self.assertEqual({a.id for a in agents}, {'deepseek-agent', 'product-agent', 'service-agent'})
        for agent in agents:
            self.assertIn(module.SYSTEM_PROMPT, agent.instructions)
            self.assertIsNot(agent, module.agent)
            self.assertIsNot(agent.model, module.agent.model)


if __name__ == '__main__':
    unittest.main()
