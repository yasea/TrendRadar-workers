// 数据处理和分析模块
export class DataProcessor {
    constructor(config) {
        this.config = config;
    }

    // 解析关键词配置
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
            let groupMaxCount = 0;

            for (const word of words) {
                const trimmed = word.trim().toLowerCase(); // 预先转小写

                if (trimmed.startsWith('@')) {
                    const count = parseInt(trimmed.substring(1));
                    if (count > 0) {
                        groupMaxCount = count;
                    }
                } else if (trimmed.startsWith('!')) {
                    const filterWord = trimmed.substring(1);
                    if (filterWord) filterWords.push(filterWord);
                } else if (trimmed.startsWith('+')) {
                    const reqWord = trimmed.substring(1);
                    if (reqWord) groupRequiredWords.push(reqWord);
                } else {
                    if (trimmed) groupNormalWords.push(trimmed);
                }
            }

            // 只有当组内有关键词时才添加
            if (groupRequiredWords.length > 0 || groupNormalWords.length > 0) {
                // 用于显示的 groupKey 尽量保持原样或首字母大写？
                // 这里简单起见，使用 keywordsText 中的原始大小写可能更好，但为了性能我们存储了小写。
                // 如果需要原始大小写用于显示，可能需要保留一份。
                // 暂时使用小写后的组合作为 key，或者重构逻辑保留原始词用于 key generation。
                // 为了兼容现有逻辑，我们用 filter 之前的 raw words 来生成 key 比较麻烦。
                // 简单处理：key 也用小写。
                const groupKey = groupNormalWords.length > 0
                    ? groupNormalWords.join(' ')
                    : groupRequiredWords.join(' ');

                processedGroups.push({
                    required: groupRequiredWords,
                    normal: groupNormalWords,
                    groupKey, // Note: this is now lowercase
                    maxCount: groupMaxCount
                });
            }
        }

        return { groups: processedGroups, filterWords };
    }

    // 匹配新闻标题 (使用预处理的小写标题)
    matchTitle(lowerTitle, wordGroup) {
        // 检查必须词
        for (const requiredWord of wordGroup.required) {
            if (!lowerTitle.includes(requiredWord)) {
                return false;
            }
        }

        // 检查普通词
        if (wordGroup.normal.length > 0) {
            for (const normalWord of wordGroup.normal) {
                if (lowerTitle.includes(normalWord)) {
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
        // 初始化结果容器
        const matchedNews = {};
        for (const group of keywordGroups) {
            matchedNews[group.groupKey] = [];
        }

        // 遍历所有数据源
        for (const [sourceId, titles] of Object.entries(results)) {
            const sourceName = idToName[sourceId] || sourceId;

            // 遍历每个数据源的新闻
            for (const [title, info] of Object.entries(titles)) {

                // 1. 预处理标题
                const lowerTitle = title.toLowerCase();

                // 2. 全局过滤词检查 (快速失败)
                let isFiltered = false;
                for (const filterWord of filterWords) { // filterWords already lowercase
                    if (lowerTitle.includes(filterWord)) {
                        isFiltered = true;
                        break;
                    }
                }
                if (isFiltered) continue;

                // 3. 匹配各关键词组
                for (const group of keywordGroups) {
                    if (this.matchTitle(lowerTitle, group)) {
                        const weight = this.calculateWeight(info);

                        matchedNews[group.groupKey].push({
                            title, // 保留原始标题
                            source: sourceName,
                            sourceId,
                            ranks: info.ranks,
                            url: info.url,
                            mobileUrl: info.mobileUrl,
                            weight,
                            firstRank: Math.min(...info.ranks),
                            count: info.ranks.length
                        });

                        // 一条新闻可能属于多个组吗？逻辑上是允许的。
                        // 如果希望一条新闻只属于一个组，可以在这里 break。
                        // 但现有逻辑是允许归属多组的。
                    }
                }
            }
        }

        // 后处理：排序和截断
        for (const groupKey in matchedNews) {
            const list = matchedNews[groupKey];
            const groupConfig = keywordGroups.find(g => g.groupKey === groupKey);

            if (!list || list.length === 0) continue;

            // 排序
            if (this.config.SORT_BY_POSITION_FIRST) {
                list.sort((a, b) => b.weight - a.weight); // 实际上这里和下面逻辑反了？
                // 原代码：SORT_BY_POSITION_FIRST -> weight desc.
                // else -> count desc, weight desc.
                // 保持原样
                list.sort((a, b) => b.weight - a.weight);
            } else {
                list.sort((a, b) => {
                    if (b.count !== a.count) return b.count - a.count;
                    return b.weight - a.weight;
                });
            }

            // 限制数量
            const maxCount = groupConfig?.maxCount || this.config.MAX_NEWS_PER_KEYWORD;
            if (maxCount > 0 && list.length > maxCount) {
                matchedNews[groupKey] = list.slice(0, maxCount);
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
