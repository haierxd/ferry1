"""独立的 DeepSeek Agent 定义；不包含 HTTP 路由、前端逻辑或数据库创建。

修改系统提示词：编辑下方 SYSTEM_PROMPT。
直接运行或导入本文件均不会自动调用模型；只有聊天请求才会调用。
"""
if not __package__:
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agno.agent import Agent
from agno.models.deepseek import DeepSeek

from personal_agent.settings import Settings


# ==================== 在这里修改系统提示词 ====================
SYSTEM_PROMPT = """
你是一位友好、专业的中文企业 AI 助手。

回答要求：
1. 用简洁清晰的中文回答，区分已知事实、通用建议与需要确认的信息。
2. 结合当前会话的上下文，正确回答用户对之前对话的追问。
3. 目前尚未连接企业知识库或业务工具，不能声称已查询公司文件、
   真实产品参数、订单或服务政策。
4. 缺少企业专属事实时坦诚说明，并提出必要的澄清问题，
   不编造资料引用、联系方式或承诺。
""".strip()


_settings = Settings.from_env()

# 这是可独立使用的 Agent，与用户提供的 Agent(model=DeepSeek(...)) 写法一致。
agent = Agent(
    id="deepseek-agent",
    name="企业知识助手",
    model=DeepSeek(
        id=_settings.model_id,  # 默认 deepseek-v4-flash，可在 .env 中配置。
        api_key=_settings.api_key,
        use_thinking=False,
        timeout=90.0,
        max_retries=0,
    ),
    instructions=SYSTEM_PROMPT,
    markdown=True,
    add_history_to_context=True,
    num_history_runs=10,
    telemetry=False,
)


# 三个现有网页入口的兼容配置。公共规则统一来自上方 SYSTEM_PROMPT。
# API 注册、数据库创建仍由 agentos.py 负责。
AGENT_IDS = {
    "knowledge": "deepseek-agent",
    "product": "product-agent",
    "service": "service-agent",
}
ROLE_DETAILS = {
    "knowledge": ("企业知识助手", "你的名字是小知，帮助用户解答企业知识相关问题。"),
    "product": ("产品顾问", "帮助用户澄清应用场景、选型约束与需要技术团队确认的事项。"),
    "service": ("服务支持助手", "帮助用户梳理故障现象、排查步骤和服务沟通信息。"),
}


def create_agents(settings: Settings, db=None) -> list[Agent]:
    """为现有 AgentOS 创建独立实例，复用上方 Agent 定义和系统提示词。"""
    return [
        agent.deep_copy(update={
            "id": AGENT_IDS[role],
            "name": name,
            "model": DeepSeek(
                id=settings.model_id,
                api_key=settings.api_key,
                use_thinking=False,
                timeout=90.0,
                max_retries=0,
            ),
            "instructions": [SYSTEM_PROMPT, role_instruction],
            "db": db,
        })
        for role, (name, role_instruction) in ROLE_DETAILS.items()
    ]


if __name__ == "__main__":
    print("Agent 已加载，未向 DeepSeek 发起请求。启动聊天服务请运行 agentos.py。")
