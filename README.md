# TrendRadar-workers - 趋势雷达 (Cloudflare Workers 版)

TrendRadar-workers 是一个运行在 Cloudflare Workers 上的轻量级趋势监控与新闻聚合工具。它能自动抓取各大主流平台的热点内容，通过关键词过滤和 AI 翻译，筛选出你感兴趣的高价值信息，并实时推送到你的即时通讯工具（钉钉、企业微信、飞书、Telegram）。
 - 参考原仓库 https://github.com/sansan0/TrendRadar

## ✨ 核心功能

*   **多平台聚合**: 支持 10+ 个主流平台，包括：
    *   **科技/极客**: GitHub Trending, Hacker News, IT之家, 少数派
    *   **财经/新闻**: 财联社(深度), 华尔街见闻, 澎湃新闻, 联合早报, 参考消息(军事)
    *   **社交媒体**: 微博热搜
    *   **支持的平台见后文**
*   **智能过滤**: 基于自定义关键词库（支持通过 API 动态管理）精准筛选内容。
*   **AI 增强**: 内置 DeepSeek API 支持，用于**标题翻译**和**深度语义去重**。
*   **双重去重机制**: 
    *   **算法去重**: 混合使用 Jaccard 相似度与 Levenshtein 编辑距离算法，快速识别相似内容。
    *   **AI 深度去重**: 对算法筛选后的结果进行二次语义分析（需配置 DeepSeek API），识别同义改写、多源报道等复杂重复场景。
    *   **AI 深度去重**: 对算法筛选后的结果进行二次语义分析（需配置 DeepSeek API），识别同义改写、多源报道等复杂重复场景。
    *   **智能上下文**: 自动结合 7 天内的高相关性历史记录进行增量去重，确保内容的唯一性和连贯性。
    *   **高性能优化**: 采用 Jaccard 相似度预筛选和 Fast-Fail 机制，大幅降低 Levenshtein 编辑距离计算的 CPU 消耗，防止 Worker 超时。
*   **多种推送模式**:
    *   `incremental`: **增量模式** (推荐)，只推送自上次以来新增的内容，避免打扰。
    *   `daily`: 日报模式，汇总当日所有内容。
    *   `current`: 即时榜单模式。
*   **节假日适配**: 自动识别节假日和周末，智能调整推送策略（仅在特定时段推送或暂停），支持强制执行。
*   **成本监控**: 提供 `/api/token_logs` 接口，实时监控 AI Token 消耗情况，助你优化成本。
*   **无服务器部署**: 完全基于 Cloudflare Workers + KV，低成本、高可用，零运维压力。

## 🚀 快速部署

### 1. 环境准备
*   安装 [Node.js](https://nodejs.org/) (v16+)
*   安装 Wrangler CLI: `npm install -g wrangler`
*   登录 Cloudflare: `wrangler login`

### 2. 项目配置
克隆项目后，安装依赖：
```bash
npm install
```

### 3. 创建 KV 存储
使用 Cloudflare KV 存储历史数据和关键词。
```bash
# 创建 KV 命名空间
wrangler kv:namespace create "TRENDRADAR_KV"

# ⚠️ 记下输出中的 id
```

修改 `wrangler.toml` 文件，填入上一步获取的 KV ID：
```toml
[[kv_namespaces]]
binding = "TRENDRADAR_KV"
id = "你的_KV_ID_粘贴在这里"
```

### 4. 部署上线
```bash
wrangler deploy
```
部署成功后，你将获得一个 Worker URL，例如 `https://trendradar-worker.your-name.workers.dev`。

## ⚙️ 配置说明

### 环境变量 (`wrangler.toml` 或 Cloudflare 后台)

| 变量名 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `REPORT_MODE` | 推送模式: `incremental`, `daily`, `current` | `incremental` |
| `ENABLE_CRAWLER` | 是否启用爬虫 | `true` |
| `ENABLE_NOTIFICATION` | 是否启用推送 | `true` |
| `HOLIDAY_SCHEDULE_HOURS` | 节假日允许推送的小时 (JSON 数组) | `[10, 12, 16, 20]` |

### 敏感配置 (Secrets)
**请勿将其直接写入代码！** 使用 `wrangler secret put KEY_NAME` 设置：

*   **AI 翻译 (推荐)**:
    *   `DEEPSEEK_API_KEY`: DeepSeek API Key，用于标题翻译。
    *   `JUHE_API_KEY`: (可选) 聚合数据 API Key，用于更精准的节假日判断。
*   **推送渠道 (选填其一或多)**:
    *   **企业微信**: `WEWORK_WEBHOOK_URL`
    *   **钉钉**: `DINGTALK_WEBHOOK_URL`
    *   **飞书**: `FEISHU_WEBHOOK_URL`
    *   **Telegram**: `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_CHAT_ID`

## 🔌 API 接口

| 接口路径 | 方法 | 说明 | 参数 |
| :--- | :--- | :--- | :--- |
| `/api/crawl` | GET | **手动触发抓取**。通常由 Cron 自动调用。 | `force=1`: 忽略节假日限制强制执行 |
| `/api/push` | GET | **手动触发推送**。 | `force=1`: **强制推送**当天所有去重后的内容，忽略增量模式的空内容拦截。（强制推送时会自动排除当日产生的历史记录，确保能生成报告） |
| `/api/token_logs` | GET | **查看 AI Token 消耗日志**。 | 返回最近 7 天的 Token 消耗统计与详情 |
| `/api/keywords` | GET | 获取当前关键词列表 | - |
| `/api/keywords` | POST | 更新关键词列表 (纯文本，换行分隔) | Body: 关键词文本 |
| `/api/config` | GET | 查看当前生效的公共配置 | - |
| `/api/logs` | GET | 查看最近 7 天的推送记录 | - |

## 📝 关键词配置语法

通过 `/api/keywords` 接口提交的纯文本支持高级筛选语法。

*   **分组**: 使用**空行**分隔不同的关键词组。
*   **普通词**: 直接输入关键词，组内任意一个匹配即可。
*   **必须包含 (`+`)**: 例如 `+新能源`，表示标题必须包含此词。
*   **排除词 (`!`)**: 例如 `!娱乐`，表示标题不能包含此词。
*   **数量限制 (`@`)**: 例如 `@10`，限制该组最多抓取 10 条新闻。

**示例配置**:
```text
# 第一组: AI 科技 (最多 15 条)
AI
ChatGPT
DeepSeek
OpenAI
@15

# 第二组: 新能源汽车 (必须包含"汽车"或相关词，排除广告)
+汽车
特斯拉
比亚迪
!广告
!优惠
```

## 🛠️ 本地开发

启动本地开发服务器：
```bash
npm run dev
```
访问 `http://localhost:8787` 即可看到控制台页面。

## 📅 定时任务
默认配置下，爬虫会在每天 **北京时间 8:00 - 20:00 之间，每 2 小时** 自动运行一次。
你可以修改 `wrangler.toml` 中的 `[triggers].crons` 字段来调整频率。


## 📚 支持的平台
根据您的要求，已将标题信息合并到名称列，整理后的Markdown表格如下：

| key | name | url(home) |
| :--- | :--- | :--- |
| v2ex | V2EX-最新分享 | https://v2ex.com/ |
| v2ex-share | V2EX-最新分享 | https://v2ex.com/ |
| zhihu | 知乎 | https://www.zhihu.com |
| weibo | 微博-实时热搜 | https://weibo.com |
| zaobao | 联合早报 | https://www.zaobao.com |
| coolapk | 酷安-今日最热 | https://coolapk.com |
| mktnews | MKTNews-快讯 | https://mktnews.net |
| mktnews-flash | MKTNews-快讯 | https://mktnews.net |
| wallstreetcn | 华尔街见闻-快讯 | https://wallstreetcn.com/ |
| wallstreetcn-quick | 华尔街见闻-快讯 | https://wallstreetcn.com/ |
| wallstreetcn-news | 华尔街见闻-最新 | https://wallstreetcn.com/ |
| wallstreetcn-hot | 华尔街见闻-最热 | https://wallstreetcn.com/ |
| 36kr | 36氪-快讯 | https://36kr.com |
| 36kr-quick | 36氪-快讯 | https://36kr.com |
| douyin | 抖音 | https://www.douyin.com |
| hupu | 虎扑-主干道热帖 | https://hupu.com |
| tieba | 百度贴吧-热议 | https://tieba.baidu.com |
| toutiao | 今日头条 | https://www.toutiao.com |
| ithome | IT之家 | https://www.ithome.com |
| thepaper | 澎湃新闻-热榜 | https://www.thepaper.cn |
| sputniknewscn | 卫星通讯社 | https://sputniknews.cn |
| cankaoxiaoxi | 参考消息 | https://china.cankaoxiaoxi.com |
| pcbeta | 远景论坛-Win11 | https://bbs.pcbeta.com |
| pcbeta-windows11 | 远景论坛-Win11 | https://bbs.pcbeta.com |
| cls | 财联社-电报 | https://www.cls.cn |
| cls-telegraph | 财联社-电报 | https://www.cls.cn |
| cls-depth | 财联社-深度 | https://www.cls.cn |
| cls-hot | 财联社-热门 | https://www.cls.cn |
| xueqiu | 雪球-热门股票 | https://xueqiu.com |
| xueqiu-hotstock | 雪球-热门股票 | https://xueqiu.com |
| gelonghui | 格隆汇-事件 | https://www.gelonghui.com |
| fastbull | 法布财经-快讯 | https://www.fastbull.cn |
| fastbull-express | 法布财经-快讯 | https://www.fastbull.cn |
| fastbull-news | 法布财经-头条 | https://www.fastbull.cn |
| solidot | Solidot | https://solidot.org |
| hackernews | Hacker News | https://news.ycombinator.com/ |
| producthunt | Product Hunt | https://www.producthunt.com/ |
| github | Github-Today | https://github.com/ |
| github-trending-today | Github-Today | https://github.com/ |
| bilibili | 哔哩哔哩-热搜 | https://www.bilibili.com |
| bilibili-hot-search | 哔哩哔哩-热搜 | https://www.bilibili.com |
| bilibili-hot-video | 哔哩哔哩-热门视频 | https://www.bilibili.com |
| bilibili-ranking | 哔哩哔哩-排行榜 | https://www.bilibili.com |
| kuaishou | 快手 | https://www.kuaishou.com |
| kaopu | 靠谱新闻 | https://kaopu.news/ |
| jin10 | 金十数据 | https://www.jin10.com |
| baidu | 百度热搜 | https://www.baidu.com |
| nowcoder | 牛客 | https://www.nowcoder.com |
| sspai | 少数派 | https://sspai.com |
| juejin | 稀土掘金 | https://juejin.cn |
| ifeng | 凤凰网-热点资讯 | https://www.ifeng.com |
| chongbuluo | 虫部落-最新 | https://www.chongbuluo.com/forum.php?mod=guide&view=newthread |
| chongbuluo-latest | 虫部落-最新 | https://www.chongbuluo.com/forum.php?mod=guide&view=newthread |
| chongbuluo-hot | 虫部落-最热 | https://www.chongbuluo.com/forum.php?mod=guide&view=hot |
| douban | 豆瓣-热门电影 | https://www.douban.com |
| steam | Steam-在线人数 | https://store.steampowered.com |
| tencent | 腾讯新闻-综合早报 | https://news.qq.com/tag/aEWqxLtdgmQ= |
| tencent-hot | 腾讯新闻-综合早报 | https://news.qq.com/tag/aEWqxLtdgmQ= |