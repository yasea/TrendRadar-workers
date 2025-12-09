# TrendRadar-workers · 趋势雷达（Cloudflare Workers 版）

TrendRadar-workers 是一个运行在 **Cloudflare Workers** 上的轻量级趋势监控与新闻聚合系统。
它能自动抓取各大主流平台的热点内容，通过自定义关键词筛选和 AI 翻译、去重算法，精准推送你关心的信息至即时通讯工具（企业微信、钉钉、飞书、Telegram）。

> 参考原项目：[https://github.com/sansan0/TrendRadar](https://github.com/sansan0/TrendRadar)

---

## ✨ 核心特性

### 📰 多平台内容聚合

支持 **10+ 主流站点**，覆盖科技、财经、媒体、论坛等领域：

* **科技/极客**：GitHub Trending、Hacker News、IT之家、少数派
* **财经/新闻**：财联社（深度）、华尔街见闻、澎湃新闻、联合早报、参考消息（军事）
* **社交与热点**：微博热搜等

> 完整平台列表见文末表格。

---

### 🎯 智能过滤系统

* 自定义关键词库
* 支持通过 API 动态管理
* 关键词组支持逻辑语法（必须包含/排除词/数量限制等）

---

### 🤖 AI 加持（翻译 + 语义去重）

内置 **DeepSeek API**，实现：

* **标题翻译**
* **深度语义去重**（识别同义改写、多源重复报道）
* 自动参考 **最近 7 天上下文** 做增量语义判断
* 采用 **Jaccard + Levenshtein** 高性能混合算法（附 Fast-Fail 优化）

---

### 🔁 高级去重机制

1. **算法层去重**：Jaccard + Levenshtein
2. **AI 层语义去重**：DeepSeek 识别语义高度相似内容
3. **历史上下文关联去重**
4. **性能优化**：利用 Jaccard 预筛选减少 Workers CPU 负载、防止超时

---

### 📤 灵活推送模式

* `incremental`：增量推送（推荐）
* `daily`：每日摘要
* `current`：即时榜单模式

---

### 📆 节假日智能调度

* 自动识别节假日/周末
* 限定时间段推送
* 可使用 `force=1` 强制执行

---

### 💰 成本可观测性

提供 `/api/token_logs` 接口查看 AI Token 消耗，以便优化使用成本。

---

### ☁️ 无服务器部署

* 基于 **Cloudflare Workers + KV**
* 无需服务器
* 高可用、低成本、免运维

---

## 🚀 快速部署

### 1. 环境准备

```bash
# 安装 Node.js (v16+)
# 安装 Wrangler
npm install -g wrangler

# 登录 Cloudflare
wrangler login
```

### 2. 安装依赖

```bash
npm install
```

### 3. 创建 KV 存储

```bash
wrangler kv:namespace create "TRENDRADAR_KV"
```

将输出的 KV ID 写入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "TRENDRADAR_KV"
id = "你的_KV_ID"
```

### 4. 部署上线

```bash
wrangler deploy
```

部署后将获得如：
`https://trendradar-worker.your-name.workers.dev`

---

## ⚙️ 配置说明

### 环境变量（Cloudflare 后台或 wrangler.toml）

| 变量名                      | 说明                                   | 默认值                |
| ------------------------ | ------------------------------------ | ------------------ |
| `REPORT_MODE`            | 推送模式：`incremental` `daily` `current` | `incremental`      |
| `ENABLE_CRAWLER`         | 是否启用爬虫                               | `true`             |
| `ENABLE_NOTIFICATION`    | 是否启用推送                               | `true`             |
| `HOLIDAY_SCHEDULE_HOURS` | 节假日允许推送小时段                           | `[10, 12, 16, 20]` |

### API Key 获取

* **DeepSeek**：[https://bailian.console.aliyun.com/?tab=model#/api-key](https://bailian.console.aliyun.com/?tab=model#/api-key)
* **聚合数据**（节假日判断）：[https://www.juhe.cn/docs/api/id/606](https://www.juhe.cn/docs/api/id/606)

---

## 🔐 敏感配置（Secrets）

请使用指令设置，不要写入代码：

```bash
wrangler secret put DEEPSEEK_API_KEY
wrangler secret put JUHE_API_KEY
wrangler secret put WEWORK_WEBHOOK_URL
...
```

**可配置的推送渠道：**

* 企业微信：`WEWORK_WEBHOOK_URL`
* 钉钉：`DINGTALK_WEBHOOK_URL`
* 飞书：`FEISHU_WEBHOOK_URL`
* Telegram：`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`

---

## 🔌 API 接口说明

| API               | 方法   | 用途             | 参数说明               |
| ----------------- | ---- | -------------- | ------------------ |
| `/api/crawl`      | GET  | 手动触发抓取         | `force=1` 强制执行     |
| `/api/push`       | GET  | 手动触发推送         | `force=1` 强制推送全部内容 |
| `/api/token_logs` | GET  | 查看 AI Token 消耗 | -                  |
| `/api/keywords`   | GET  | 获取关键词列表        | -                  |
| `/api/keywords`   | POST | 更新关键词（纯文本）     | Body 为换行分隔关键词      |
| `/api/config`     | GET  | 查看当前配置         | -                  |
| `/api/logs`       | GET  | 查看最近 7 天推送日志   | -                  |

---

## 📝 关键词语法说明

支持高级筛选规则：

* **分组**：空行分隔不同组
* **普通词**：任一命中即可
* **必须包含**：`+关键词`
* **排除词**：`!关键词`
* **数量限制**：`@10` 表示最多抓取 10 条

示例：

```text
# 第一组：AI 科技（最多 15 条）
AI
ChatGPT
DeepSeek
OpenAI
@15

# 第二组：新能源（必须包含"汽车"，排除广告内容）
+汽车
特斯拉
比亚迪
!广告
!优惠
```

---

## 🛠️ 本地开发

```bash
npm run dev
```

访问：
`http://localhost:8787`

---

## ⏰ 定时任务

默认：每日 **8:00–20:00 每 2 小时** 运行一次。
可在 `wrangler.toml` 修改：

```toml
[triggers]
crons = ["0 */2 8-20 * * *"]
```

---

## 📚 支持的平台列表

> 已将 “标题信息” 合并到 name 列，结构更清晰。

| key                   | name         | url(home)                                                        |
| --------------------- | ------------ | ---------------------------------------------------------------- |
| v2ex                  | V2EX-最新分享    | [https://v2ex.com/](https://v2ex.com/)                           |
| v2ex-share            | V2EX-最新分享    | [https://v2ex.com/](https://v2ex.com/)                           |
| zhihu                 | 知乎           | [https://www.zhihu.com](https://www.zhihu.com)                   |
| weibo                 | 微博-实时热搜      | [https://weibo.com](https://weibo.com)                           |
| zaobao                | 联合早报         | [https://www.zaobao.com](https://www.zaobao.com)                 |
| coolapk               | 酷安-今日最热      | [https://coolapk.com](https://coolapk.com)                       |
| mktnews               | MKTNews-快讯   | [https://mktnews.net](https://mktnews.net)                       |
| mktnews-flash         | MKTNews-快讯   | [https://mktnews.net](https://mktnews.net)                       |
| wallstreetcn          | 华尔街见闻-快讯     | [https://wallstreetcn.com/](https://wallstreetcn.com/)           |
| wallstreetcn-quick    | 华尔街见闻-快讯     | [https://wallstreetcn.com/](https://wallstreetcn.com/)           |
| wallstreetcn-news     | 华尔街见闻-最新     | [https://wallstreetcn.com/](https://wallstreetcn.com/)           |
| wallstreetcn-hot      | 华尔街见闻-最热     | [https://wallstreetcn.com/](https://wallstreetcn.com/)           |
| 36kr                  | 36氪-快讯       | [https://36kr.com](https://36kr.com)                             |
| 36kr-quick            | 36氪-快讯       | [https://36kr.com](https://36kr.com)                             |
| douyin                | 抖音           | [https://www.douyin.com](https://www.douyin.com)                 |
| hupu                  | 虎扑-主干道热帖     | [https://hupu.com](https://hupu.com)                             |
| tieba                 | 百度贴吧-热议      | [https://tieba.baidu.com](https://tieba.baidu.com)               |
| toutiao               | 今日头条         | [https://www.toutiao.com](https://www.toutiao.com)               |
| ithome                | IT之家         | [https://www.ithome.com](https://www.ithome.com)                 |
| thepaper              | 澎湃新闻-热榜      | [https://www.thepaper.cn](https://www.thepaper.cn)               |
| sputniknewscn         | 卫星通讯社        | [https://sputniknews.cn](https://sputniknews.cn)                 |
| cankaoxiaoxi          | 参考消息         | [https://china.cankaoxiaoxi.com](https://china.cankaoxiaoxi.com) |
| pcbeta                | 远景论坛-Win11   | [https://bbs.pcbeta.com](https://bbs.pcbeta.com)                 |
| pcbeta-windows11      | 远景论坛-Win11   | [https://bbs.pcbeta.com](https://bbs.pcbeta.com)                 |
| cls                   | 财联社-电报       | [https://www.cls.cn](https://www.cls.cn)                         |
| cls-telegraph         | 财联社-电报       | [https://www.cls.cn](https://www.cls.cn)                         |
| cls-depth             | 财联社-深度       | [https://www.cls.cn](https://www.cls.cn)                         |
| cls-hot               | 财联社-热门       | [https://www.cls.cn](https://www.cls.cn)                         |
| xueqiu                | 雪球-热门股票      | [https://xueqiu.com](https://xueqiu.com)                         |
| xueqiu-hotstock       | 雪球-热门股票      | [https://xueqiu.com](https://xueqiu.com)                         |
| gelonghui             | 格隆汇-事件       | [https://www.gelonghui.com](https://www.gelonghui.com)           |
| fastbull              | 法布财经-快讯      | [https://www.fastbull.cn](https://www.fastbull.cn)               |
| fastbull-express      | 法布财经-快讯      | [https://www.fastbull.cn](https://www.fastbull.cn)               |
| fastbull-news         | 法布财经-头条      | [https://www.fastbull.cn](https://www.fastbull.cn)               |
| solidot               | Solidot      | [https://solidot.org](https://solidot.org)                       |
| hackernews            | Hacker News  | [https://news.ycombinator.com/](https://news.ycombinator.com/)   |
| producthunt           | Product Hunt | [https://www.producthunt.com/](https://www.producthunt.com/)     |
| github                | GitHub Today | [https://github.com/](https://github.com/)                       |
| github-trending-today | GitHub Today | [https://github.com/](https://github.com/)                       |
| bilibili              | 哔哩哔哩-热搜      | [https://www.bilibili.com](https://www.bilibili.com)             |
| bilibili-hot-search   | 哔哩哔哩-热搜      | [https://www.bilibili.com](https://www.bilibili.com)             |
| bilibili-hot-video    | 哔哩哔哩-热门视频    | [https://www.bilibili.com](https://www.bilibili.com)             |
| bilibili-ranking      | 哔哩哔哩-排行榜     | [https://www.bilibili.com](https://www.bilibili.com)             |
| kuaishou              | 快手           | [https://www.kuaishou.com](https://www.kuaishou.com)             |
| kaopu                 | 靠谱新闻         | [https://kaopu.news/](https://kaopu.news/)                       |
| jin10                 | 金十数据         | [https://www.jin10.com](https://www.jin10.com)                   |
| baidu                 | 百度热搜         | [https://www.baidu.com](https://www.baidu.com)                   |
| nowcoder              | 牛客           | [https://www.nowcoder.com](https://www.nowcoder.com)             |
| sspai                 | 少数派          | [https://sspai.com](https://sspai.com)                           |
| juejin                | 稀土掘金         | [https://juejin.cn](https://juejin.cn)                           |
| ifeng                 | 凤凰网-热点资讯     | [https://www.ifeng.com](https://www.ifeng.com)                   |
| chongbuluo            | 虫部落-最新       | [https://www.chongbuluo.com](https://www.chongbuluo.com)         |

