"""兼容入口：复用 personal_agent 中的 Agent，启动时不调用模型。"""
from personal_agent.agent import agent

if __name__ == "__main__":
    print("Agent 已加载，未向 DeepSeek 发起请求。启动聊天服务请运行 personal_agent/agentos.py。")
