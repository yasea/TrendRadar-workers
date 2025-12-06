// 数据处理和分析模块
export class DataProcessor {
    constructor(config) {
        this.config = config;
    }

    // 解析关键词配置
    parseKeywords(keywordsText) {
        if (!keywordsText || !keywordsText.trim()) {
            return { groups: [], filterWords: [] };
        }

        const wordGroups = keywordsText.split('\n\n').filter(g => g.trim());
        const processedGroups = [];
        const filterWords = [];

        for (const group of wordGroups) {
            const words = group.split('\n').filter(w => w.trim());

            const groupRequiredWords = [];
            const groupNormalWords = [];
            const groupFilterWords = [];
            let groupMaxCount = 0;

            for (const word of words) {
                const trimmed = word.trim();

                if (trimmed.startsWith('@')) {
                    const count = parseInt(trimmed.substring(1));
                    if (count > 0) {
                        groupMaxCount = count;
                    }
                } else if (trimmed.startsWith('!')) {
                    const filterWord = trimmed.substring(1);
                    filterWords.push(filterWord);
                    groupFilterWords.push(filterWord);
                } else if (trimmed.startsWith('+')) {
                    groupRequiredWords.push(trimmed.substring(1));
                } else {
                    groupNormalWords.push(trimmed);
                }
            }

            if (groupRequiredWords.length > 0 || groupNormalWords.length > 0) {
                const groupKey = groupNormalWords.length > 0
                    ? groupNormalWords.join(' ')
                    : groupRequiredWords.join(' ');

                processedGroups.push({
                    required: groupRequiredWords,
                    normal: groupNormalWords,
                    groupKey,
                    maxCount: groupMaxCount
                });
            }
        }

        return { groups: processedGroups, filterWords };
    }

    // 匹配新闻标题
    matchTitle(title, wordGroup, filterWords) {
        const lowerTitle = title.toLowerCase();

        // 检查过滤词
        for (const filterWord of filterWords) {
            if (lowerTitle.includes(filterWord.toLowerCase())) {
                return false;
            }
        }

        // 检查必须词
        for (const requiredWord of wordGroup.required) {
            if (!lowerTitle.includes(requiredWord.toLowerCase())) {
                return false;
            }
        }

        // 检查普通词
        if (wordGroup.normal.length > 0) {
            for (const normalWord of wordGroup.normal) {
                if (lowerTitle.includes(normalWord.toLowerCase())) {
                    return true;
                }
            }
            return false;
        }

        return true;
    }

    // 计算新闻权重
    calculateWeight(newsItem) {
        const { ranks } = newsItem;
        const config = this.config.WEIGHT_CONFIG;

        // 排名权重 (排名越高分数越高)
        const avgRank = ranks.reduce((a, b) => a + b, 0) / ranks.length;
        const rankScore = 1 / avgRank;

        // 频次权重 (出现次数越多分数越高)
        const frequencyScore = ranks.length;

        // 热度权重 (综合排名质量)
        const hotnessScore = ranks.filter(r => r <= 10).length / ranks.length;

        const totalWeight =
            rankScore * config.RANK_WEIGHT +
            frequencyScore * config.FREQUENCY_WEIGHT +
            hotnessScore * config.HOTNESS_WEIGHT;

        return totalWeight;
    }

    // 处理新闻数据
    processNews(results, idToName, keywordGroups, filterWords) {
        const matchedNews = {};

        for (const group of keywordGroups) {
            matchedNews[group.groupKey] = [];

            for (const [sourceId, titles] of Object.entries(results)) {
                const sourceName = idToName[sourceId] || sourceId;

                for (const [title, info] of Object.entries(titles)) {
                    if (this.matchTitle(title, group, filterWords)) {
                        const weight = this.calculateWeight(info);

                        matchedNews[group.groupKey].push({
                            title,
                            source: sourceName,
                            sourceId,
                            ranks: info.ranks,
                            url: info.url,
                            mobileUrl: info.mobileUrl,
                            weight,
                            firstRank: Math.min(...info.ranks),
                            count: info.ranks.length
                        });
                    }
                }
            }

            // 排序
            if (this.config.SORT_BY_POSITION_FIRST) {
                // 按配置位置排序
                matchedNews[group.groupKey].sort((a, b) => b.weight - a.weight);
            } else {
                // 按热度排序
                matchedNews[group.groupKey].sort((a, b) => {
                    if (b.count !== a.count) return b.count - a.count;
                    return b.weight - a.weight;
                });
            }

            // 限制数量
            const maxCount = group.maxCount || this.config.MAX_NEWS_PER_KEYWORD;
            if (maxCount > 0) {
                matchedNews[group.groupKey] = matchedNews[group.groupKey].slice(0, maxCount);
            }
        }

        return matchedNews;
    }

    // 获取当前时间 (北京时间)
    getBeijingTime() {
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const beijing = new Date(utc + (8 * 3600000));
        return beijing;
    }

    // 格式化日期
    formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}年${month}月${day}日`;
    }

    // 格式化时间
    formatTime(date) {
        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');
        return `${hour}时${minute}分`;
    }
}
