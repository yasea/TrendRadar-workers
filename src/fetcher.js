// 数据抓取模块
export class DataFetcher {
    constructor(config) {
        this.config = config;
    }

    // 抓取单个平台数据
    async fetchData(idInfo, maxRetries = 2) {
        const id = typeof idInfo === 'object' ? idInfo.id : idInfo;
        const alias = typeof idInfo === 'object' ? idInfo.name : id;
        const url = `https://newsnow.busiyi.world/api/s?id=${id}&latest`;

        for (let retry = 0; retry <= maxRetries; retry++) {
            try {
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json, text/plain, */*',
                        'Cache-Control': 'no-cache'
                    }
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();

                if (!['success', 'cache'].includes(data.status)) {
                    throw new Error(`响应状态异常: ${data.status}`);
                }

                console.log(`获取 ${id} 成功 (${data.status})`);
                return { data, id, alias };
            } catch (error) {
                if (retry < maxRetries) {
                    const waitTime = 3000 + retry * 2000;
                    console.log(`请求 ${id} 失败: ${error.message}, ${waitTime}ms后重试...`);
                    await this.sleep(waitTime);
                } else {
                    console.error(`请求 ${id} 失败: ${error.message}`);
                    return { data: null, id, alias };
                }
            }
        }
    }

    // 抓取多个平台数据
    async crawlWebsites(platforms) {
        const results = {};
        const idToName = {};
        const failedIds = [];

        for (let i = 0; i < platforms.length; i++) {
            const platform = platforms[i];
            const id = platform.id;
            const name = platform.name;

            idToName[id] = name;

            const { data } = await this.fetchData(platform);

            if (data && data.items) {
                results[id] = {};

                data.items.forEach((item, index) => {
                    const title = item.title;

                    // 跳过无效标题
                    if (!title || typeof title !== 'string' || !title.trim()) {
                        return;
                    }

                    const cleanTitle = title.trim();
                    const url = item.url || '';
                    const mobileUrl = item.mobileUrl || '';
                    const rank = index + 1;

                    if (results[id][cleanTitle]) {
                        results[id][cleanTitle].ranks.push(rank);
                    } else {
                        results[id][cleanTitle] = {
                            ranks: [rank],
                            url,
                            mobileUrl
                        };
                    }
                });
            } else {
                failedIds.push(id);
            }

            // 请求间隔
            if (i < platforms.length - 1) {
                await this.sleep(this.config.REQUEST_INTERVAL);
            }
        }

        console.log(`成功: ${Object.keys(results).length}, 失败: ${failedIds.length}`);
        return { results, idToName, failedIds };
    }

    // 简化的去重函数 (不使用ML模型)
    deduplicateNews(newsList) {
        // 使用简单的字符串相似度去重
        const deduplicated = [];
        const seen = new Set();

        for (const news of newsList) {
            const title = news.title.toLowerCase().trim();

            // 简单的相似度检查
            let isDuplicate = false;
            for (const seenTitle of seen) {
                if (this.calculateSimilarity(title, seenTitle) > 0.8) {
                    isDuplicate = true;
                    break;
                }
            }

            if (!isDuplicate) {
                deduplicated.push(news);
                seen.add(title);
            }
        }

        return deduplicated;
    }

    // 计算字符串相似度 (Jaccard相似度)
    calculateSimilarity(str1, str2) {
        const set1 = new Set(str1.split(''));
        const set2 = new Set(str2.split(''));

        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const union = new Set([...set1, ...set2]);

        return intersection.size / union.size;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
