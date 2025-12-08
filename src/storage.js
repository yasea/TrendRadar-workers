// 存储管理模块 (使用Cloudflare KV)
export class StorageManager {
    constructor(kv) {
        this.kv = kv;
    }

    // 保存今日新闻数据
    async saveTodayNews(newsData) {
        const today = this.getDateKey();
        const key = `news:${today}`;

        await this.kv.put(key, JSON.stringify(newsData), {
            expirationTtl: 86400 * 7 // 7天过期
        });
    }

    // 获取今日新闻数据
    async getTodayNews() {
        const today = this.getDateKey();
        const key = `news:${today}`;

        const data = await this.kv.get(key);
        return data ? JSON.parse(data) : null;
    }

    // 保存历史新闻标题 (用于增量模式 - 7天滚动窗口)
    async saveHistoryTitles(titles) {
        const key = 'history_titles_7days';
        const now = Date.now();
        const sevenDaysAgo = now - (7 * 86400 * 1000);

        // 获取现有历史记录
        let historyData = {};
        try {
            const existing = await this.kv.get(key);
            if (existing) {
                historyData = JSON.parse(existing);
            }
        } catch (e) {
            console.error('读取历史记录失败:', e);
            historyData = {};
        }

        // 清理7天前的数据
        const cleanedData = {};
        for (const [timestamp, titleList] of Object.entries(historyData)) {
            if (parseInt(timestamp) > sevenDaysAgo) {
                cleanedData[timestamp] = titleList;
            }
        }

        // 添加当前标题（使用当前时间戳作为key）
        cleanedData[now] = Array.isArray(titles) ? titles : Array.from(titles);

        // 保存更新后的历史记录（30天过期，实际只保留7天数据）
        await this.kv.put(key, JSON.stringify(cleanedData), {
            expirationTtl: 86400 * 30
        });

        console.log('📝 保存历史标题:', {
            新增标题数: cleanedData[now].length,
            历史记录条数: Object.keys(cleanedData).length,
            总标题数: Object.values(cleanedData).flat().length
        });
    }

    // 获取历史新闻标题（最近7天）
    async getHistoryTitles(excludeToday = false) {
        const key = 'history_titles_7days';
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const beijingNow = new Date(utc + (8 * 3600000));

        // 计算北京时间今天凌晨的时间戳 (用于排除今天的数据)
        const beijingTodayStart = new Date(beijingNow.getFullYear(), beijingNow.getMonth(), beijingNow.getDate()).getTime();
        // 将北京时间转换回UTC时间戳 (因为存储的是UTC时间戳? 不，存储的是 Date.now() 即 UTC)
        // Date.now() 是 UTC 时间戳。
        // beijingTodayStart 是 "北京时间今天0点" 对应的 Date 对象，其 .getTime() 返回的是该时刻的 UTC 时间戳。
        // 例如 北京 8:00 -> UTC 0:00 -> timestamp X.
        // 所以直接用 .getTime() 比较存储的 timestamps 是正确的。
        const startOfToday = beijingTodayStart - (8 * 3600000); // 修正：上面构造的 "new Date(y,m,d)" 是基于本地时区还是？

        // new Date(...) 在 Cloudflare Worker 中通常是 UTC。
        // 让我们简化逻辑：
        // 存储使用的是 Date.now()。
        // 我们要排除的是 "今天" (北京时间) 产生的数据。
        // "今天" 的定义是： Beijing Time's Year/Month/Day matches current Beijing Time.

        // 重新获取当前北京时间
        const currentBeijingDate = this.getDateKey(); // YYYYMMDD string

        const timestampNow = Date.now();
        const sevenDaysAgo = timestampNow - (7 * 86400 * 1000);

        try {
            const data = await this.kv.get(key);
            if (!data) {
                console.log('📭 无历史记录');
                return new Set();
            }

            const historyData = JSON.parse(data);
            const allTitles = new Set();

            // 合并所有7天内的标题
            let validRecords = 0;
            for (const [timestamp, titleList] of Object.entries(historyData)) {
                const ts = parseInt(timestamp);

                // 1. 检查是否在7天内
                if (ts <= sevenDaysAgo) continue;

                // 2. 如果 excludeToday 为真，检查该 timestamp 是否属于 "今天"
                if (excludeToday) {
                    // 将 timestamp 转为北京时间 YYYYMMDD
                    // timestamp 是 UTC ms
                    const recordDate = new Date(ts + (8 * 3600000));
                    const recordY = recordDate.getUTCFullYear();
                    const recordM = String(recordDate.getUTCMonth() + 1).padStart(2, '0');
                    const recordD = String(recordDate.getUTCDate()).padStart(2, '0');
                    const recordDateKey = `${recordY}${recordM}${recordD}`;

                    if (recordDateKey === currentBeijingDate) {
                        continue; // 跳过今天的记录
                    }
                }

                validRecords++;
                if (Array.isArray(titleList)) {
                    titleList.forEach(title => allTitles.add(title));
                }
            }

            console.log('📚 读取历史标题:', {
                有效记录数: validRecords,
                总标题数: allTitles.size,
                时间范围: '最近7天',
                排除今日: excludeToday
            });

            return allTitles;
        } catch (e) {
            console.error('解析历史标题失败:', e);
            return new Set();
        }
    }

    // 保存推送记录
    async savePushRecord(reportType) {
        const today = this.getDateKey();
        const key = `push:${today}`;

        const record = {
            pushed: true,
            pushTime: new Date().toISOString(),
            reportType
        };

        await this.kv.put(key, JSON.stringify(record), {
            expirationTtl: 86400 * 7
        });
    }

    // 检查今天是否已推送
    async hasPushedToday() {
        const today = this.getDateKey();
        const key = `push:${today}`;

        const data = await this.kv.get(key);
        if (!data) return false;

        const record = JSON.parse(data);
        return record.pushed === true;
    }

    // 保存关键词配置
    async saveKeywords(keywords) {
        await this.kv.put('keywords', keywords);
    }

    // 记录Token消耗
    async logTokenUsage(module, model, tokens, additionalInfo = {}) {
        const today = this.getDateKey();
        const key = `token_usage:${today}`;
        const record = {
            timestamp: new Date().toISOString(),
            module,        // 'translator' | 'deduplicator'
            model,         // e.g. 'deepseek-chat'
            tokens,        // { prompt, completion, total }
            ...additionalInfo
        };

        // 获取当天现有日志
        let logs = [];
        try {
            const existing = await this.kv.get(key);
            if (existing) {
                logs = JSON.parse(existing);
            }
        } catch (e) {
            // ignore
        }

        logs.push(record);

        // 保存 (保留30天)
        await this.kv.put(key, JSON.stringify(logs), {
            expirationTtl: 86400 * 30
        });
    }

    // 获取Token消耗日志
    async getTokenUsageLogs(days = 7) {
        const logs = [];
        const today = new Date();

        for (let i = 0; i < days; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const dateKey = `${year}${month}${day}`;

            try {
                const data = await this.kv.get(`token_usage:${dateKey}`);
                if (data) {
                    const records = JSON.parse(data);
                    // 汇总当天的消耗
                    const summary = records.reduce((acc, curr) => {
                        acc.totalTokens += (curr.tokens?.total_tokens || 0);
                        acc.count += 1;
                        return acc;
                    }, { date: dateKey, totalTokens: 0, count: 0, distinctModules: [...new Set(records.map(r => r.module))] });

                    logs.push({
                        date: dateKey,
                        summary,
                        records // 包含详细记录
                    });
                }
            } catch (e) {
                // ignore
            }
        }
        return logs;
    }

    // 获取关键词配置
    async getKeywords() {
        const keywords = await this.kv.get('keywords');
        return keywords || this.getDefaultKeywords();
    }

    // 获取默认关键词
    getDefaultKeywords() {
        return `AI
人工智能
大模型
LLM
AIGC
AGI
多模态
视频生成
文生图
Midjourney
Stable Diffusion
ChatGPT
OpenAI
o1
Claude
Gemini
DeepSeek
Kimi
Qwen
通义千问
文心一言
RAG
Prompt
AI Agent
@20

NVIDIA
英伟达
黄仁勋
AMD
Intel
微软
Copilot
Azure
谷歌
DeepMind
苹果
Vision Pro
Meta
扎克伯格
特斯拉
马斯克
xAI
Grok
@15

华为
鸿蒙
麒麟
阿里
阿里云
通义
腾讯
混元
字节
抖音
TikTok
百度
文心
小米
雷军
商汤
讯飞
美团
拼多多
@18

芯片
半导体
光刻机
EUV
先进制程
台积电
中芯国际
三星
长江存储
华虹
ARM
RISC-V
国产芯片
自主可控
@12

机器人
人形机器人
具身智能
工业机器人
Optimus
Atlas
优必选
宇树
自动驾驶
FSD
Waymo
Robotaxi
L4
L5
车路协同
@12

+新能源
电动车
动力电池
固态电池
比亚迪
宁德时代
理想
蔚来
小鹏
问界
充电桩
换电
氢能源
@12

航空航天
商业航天
卫星
火箭
空间站
SpaceX
星舰
Starship
星链
嫦娥
天问
神舟
!娱乐
!明星
@12

军事
国防
军工
航母
歼-20
无人机
反无人机
高超音速
导弹
反导
核潜艇
驱逐舰
无人艇
@12

国际关系
地缘政治
大国博弈
中美
台海
俄乌
中东
以色列
伊朗
朝鲜
北约
金砖
一带一路
@10

能源
清洁能源
碳中和
碳达峰
核能
核聚变
氢能
光伏
风电
储能
油价
天然气
@10

医疗
医药
生物科技
创新药
基因编辑
mRNA
CRISPR
AI医疗
脑机接口
Neuralink
抗衰老
癌症
疫苗
@12

量子计算
6G
卫星互联网
元宇宙
VR
AR
XR
区块链
Web3
比特币
云计算
边缘计算
算力
智能制造
数字经济
新质生产力
@15

胖东来
零售
商业模式
人口
老龄化
教育
高考
房地产
楼市
降息
GDP
@10

`;
    }

    // 获取日期键
    getDateKey() {
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const beijing = new Date(utc + (8 * 3600000));

        const year = beijing.getFullYear();
        const month = String(beijing.getMonth() + 1).padStart(2, '0');
        const day = String(beijing.getDate()).padStart(2, '0');

        return `${year}${month}${day}`;
    }

    // 清理过期数据
    async cleanupOldData() {
        // KV会自动根据TTL清理,这里可以添加额外的清理逻辑
        console.log('KV自动清理过期数据');
    }
}
