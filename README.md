# DailyPaper · 本地 AI 论文阅读工具

## 启动
```bash
./start.sh        # 打开 http://127.0.0.1:8765
./start.sh dev    # 开发模式（前端热更新）http://localhost:5173
```

## 配置 API
使用 Anthropic 官方 API。在 [Anthropic Console](https://console.anthropic.com/settings/keys) 创建 API Key，然后：
```bash
cp backend/.env.example backend/.env
```
编辑 `backend/.env`：
```
ANTHROPIC_API_KEY=sk-ant-你的密钥
```
留空时会沿用终端里的同名环境变量。修改后无需重启。`backend/.env` 已被 `.gitignore` 忽略，不会被提交。

如需走代理或兼容网关，可另外填写 `ANTHROPIC_BASE_URL`（以及网关要求时的 `ANTHROPIC_AUTH_TOKEN`），详见 `backend/.env.example`。

## 功能
- **☀️ 今日**：首页有活跃度仪表盘，并分两个标签：
  - **arXiv 新论文**：点「开始推送」，AI 按研究兴趣挑出前 N 篇
  - **社区热榜 & 话题**：汇总 alphaXiv 热度和 HN 讨论，AI 筛选后归纳出正在升温的话题，每个话题附一个值得深挖的问题
- **🧭 调研**：输入一条研究路线，AI 列出代表作，在 arXiv 上逐篇核实，再补充检索，最后生成带时间线的文献地图和路线综述
- **📚 文库**：按状态、表情、标签筛选，支持搜索，也可以按 arXiv ID 添加
- **💭 灵感**：记录自己的研究想法，可以关联论文；AI 合作者能帮你查重、挑刺、设计实验、发散思路。任何页面按 ⌘I 都能快速记一条
- **📖 阅读器**：PDF 配合 AI 精读、全文对话、笔记、高亮、相关论文、灵感；选中文字可以解释、翻译、提问或记想法
- **表情反馈**：🔥必读 🤩很赞 💡有启发 🤔存疑 😐一般 🗑️没价值 🙅不感兴趣。正面和负面表情都会影响之后的推荐

## 数据
全部在 `data/` 目录（SQLite + PDF 缓存），备份时复制这个目录即可。

## 安全提示
后端没有登录鉴权，且允许跨域访问，只应监听 `127.0.0.1` 在本机使用，不要部署到公网。
