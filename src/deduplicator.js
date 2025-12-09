export class DeduplicationService {
    constructor(config, storage) {
        this.config = config;
        this.storage = storage;
    }

    /**
     * 新闻去重服务 (两阶段: 严格算法 -> AI 语义)
     * @param {Array} newsList - 当前抓取的新闻列表 (待去重)
     * @param {Array} historyList - 历史新闻标题列表 (作为参考，用于增量去重)
     * @returns {Promise<Array>} - 去重后的新闻列表
     */
    async deduplicate(newsList, historyList = []) {
        if (!newsList || newsList.length === 0) return [];

        // 1. 第一阶段: 严格算法去重
        // 使用较高的阈值 (0.8) 快速筛除明显的重复项 (完全匹配或微小差异)
        // 这样可以大幅减少传给 AI 的 token 数量
        console.log('🧮 阶段一: 使用严格算法 (Similarity > 0.8) 去除明显重复项...');
        const algoResult = this.deduplicateByAlgorithm(newsList, historyList, 0.8);

        // 如果没有配置 AI，或数据量过大/为空，直接返回算法结果
        if (!this.config.DEEPSEEK_API_KEY || algoResult.length === 0) {
            return algoResult;
        }

        // 限制 AI 处理的最大数量，避免超时或 excessive cost
        if (algoResult.length > 100) {
            console.log('⚠️ 待处理数据过多 (>100)，跳过 AI 去重阶段');
            return algoResult;
        }

        try {
            // 2. 准备上下文: 筛选相关的历史记录
            // 只保留与当前剩余新闻有一定相似度 (Similarity > 0.4) 的历史记录
            // 排除完全不相关的历史记录，进一步节省 Token
            const relevantHistory = this.getRelevantHistory(algoResult, historyList, 0.4);

            console.log(`🤖 阶段二: DeepSeek 语义去重 | 待处理: ${algoResult.length} 条 | 关联历史上下文: ${relevantHistory.length} 条`);

            // 3. 第二阶段: LLM 语义去重
            return await this.deduplicateByLLM(algoResult, relevantHistory);
        } catch (e) {
            console.error('⚠️ LLM 去重失败, 降级使用算法结果:', e);
            return algoResult;
        }
    }

    /**
     * 使用 LLM 识别重复项
     */
    async deduplicateByLLM(newsList, historyList) {
        // 构建简化列表: ID -> Title (添加 Source 辅助判断)
        const targetList = newsList.map((news, index) => ({
            id: index,
            title: news.title,
            source: news.source
        }));

        // 历史列表已经是被筛选过的，只需要转换格式
        // 为了防止仍然过大，最后做一个硬截断 (比如最多 50 条)
        const contextList = historyList.slice(0, 50).map((title, index) => ({
            id: `h_${index}`,
            title: title
        }));

        const prompt = `
你是一名专业的新闻编辑。请分析【待处理列表】，找出其中重复的新闻。

判定标准(严格)：
1. **与【历史参考列表】重复**：如果新闻事件在历史上已报道过，应标记为重复。
2. **内部重复**：多条新闻报道同一具体事件，保留最佳的一条。
3. **语义相同**："iPhone 16 发布" 和 "苹果推出 iPhone 16" 是重复的。

请返回一个 JSON 对象，包含 "remove_ids" 数组，列出需要**删除**的 ID。

输入数据:
【历史参考列表】(仅作查重比对):
${JSON.stringify(contextList)}

【待处理列表】(需筛选):
${JSON.stringify(targetList)}
`;

        const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: "deepseek-v3.2", // deepseek-chat
                messages: [
                    {
                        role: "system",
                        content: "你是一个只输出 JSON 的去重助手。请识别重复新闻并返回 {\"remove_ids\": []}。"
                    },
                    { role: "user", content: prompt }
                ],
                temperature: 0.1,
                stream: false,
                response_format: { type: 'json_object' }
            })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content?.trim();

        // 记录 Token 消耗
        if (this.storage && data.usage) {
            // 异步记录，不阻塞主流程
            this.storage.logTokenUsage('deduplicator', data.model, data.usage, {
                itemCount: newsList.length,
                historyCount: historyList.length
            }).catch(e => console.error('Token logging failed:', e));
        }

        let removeIds = [];
        try {
            const parsed = JSON.parse(content);
            if (parsed.remove_ids && Array.isArray(parsed.remove_ids)) {
                removeIds = parsed.remove_ids;
            } else if (Array.isArray(parsed)) {
                removeIds = parsed;
            }
        } catch (e) {
            console.error('LLM parse error:', content);
            throw e;
        }

        console.log(`🤖 LLM 建议移除 ${removeIds.length} 条重复新闻`);

        const removeSet = new Set(removeIds.map(id => Number(id)));
        return newsList.filter((_, index) => !removeSet.has(index));
    }

    /**
     * 使用混合算法去重
     * @param {number} threshold - 相似度阈值 (默认 0.6, 严格模式建议 0.8)
     */
    /**
     * 使用混合算法去重
     * @param {number} threshold - 相似度阈值 (默认 0.6, 严格模式建议 0.8)
     */
    deduplicateByAlgorithm(newsList, historyList, threshold = 0.6) {
        const deduplicated = [];
        const seen = [];

        // 加载历史记录到 seen (设高权重以防被新新闻替换，虽然逻辑上这里只用于过滤新新闻)
        if (historyList && historyList.length > 0) {
            historyList.forEach(title => {
                seen.push({ title: title, isHistory: true, weight: 10000 });
            });
        }

        for (const news of newsList) {
            let isDuplicate = false;

            for (let i = 0; i < seen.length; i++) {
                const seenItem = seen[i];

                // 性能优化: 传入阈值，如果 Jaccard 过低直接跳过 Levenshtein 计算
                const similarity = this.calculateHybridSimilarity(news.title, seenItem.title, threshold);

                if (similarity > threshold) {
                    isDuplicate = true;

                    // 只有内部重复时才考虑替换 (权重比较)
                    // 如果和历史重复，直接丢弃
                    if (!seenItem.isHistory) {
                        if ((news.weight || 0) > (seenItem.weight || 0)) {
                            // 计算在 deduplicated 中的索引 (排除 history 的偏移)
                            const historyLen = historyList ? historyList.length : 0;
                            const targetIndex = i - historyLen;

                            if (targetIndex >= 0) {
                                deduplicated[targetIndex] = news;
                                seen[i] = news;
                            }
                        }
                    }
                    break;
                }
            }

            if (!isDuplicate) {
                deduplicated.push(news);
                seen.push(news);
            }
        }

        return deduplicated;
    }

    /**
     * 筛选相关的历史记录
     * 只有当历史记录与当前某条新闻的相似度超过 contextThreshold 时，才将其传给 AI
     */
    getRelevantHistory(newsList, historyList, contextThreshold = 0.4) {
        if (!historyList || historyList.length === 0) return [];

        const relevantSet = new Set();

        // 性能优化: 预先对 NewsList 进行分词，避免在内层循环重复分词
        const newsTokens = newsList.map(news => {
            const norm = this.normalizeText(news.title);
            return new Set(norm.split(/[\s\p{P}]+/u));
        });

        // 遍历历史记录
        // 优化: 这里只使用 Jaccard 相似度来快速筛选，避免 Levenshtein 的高 CPU 消耗
        // 上下文筛选不需要特别精确，只要有一定的词重叠即可
        for (const historyTitle of historyList) {
            const normHistory = this.normalizeText(historyTitle);
            const historyTokens = new Set(normHistory.split(/[\s\p{P}]+/u));

            if (historyTokens.size === 0) continue;

            for (let i = 0; i < newsTokens.length; i++) {
                const targetTokens = newsTokens[i];
                if (targetTokens.size === 0) continue;

                // Jaccard Calculation
                let intersection = 0;
                for (const t of historyTokens) {
                    if (targetTokens.has(t)) intersection++;
                }

                // Union size = sizeA + sizeB - intersection
                const union = historyTokens.size + targetTokens.size - intersection;
                const jaccard = intersection / union;

                if (jaccard > 0.3) { // 降低阈值，仅凭 Jaccard 筛选 (相当于原先 Hybrid 0.4 左右)
                    relevantSet.add(historyTitle);
                    break; // 命中一次即可
                }
            }

            // 限制最大上下文数量，防止 token 爆炸
            if (relevantSet.size >= 50) break;
        }

        return Array.from(relevantSet);
    }

    /**
     * 计算混合相似度 (Jaccard + Levenshtein)
     * @param {string} str1 
     * @param {string} str2 
     * @param {number} threshold - 快速失败阈值。如果提供了此值，且 Jaccard 分数使得总分绝无可能达到此阈值，则跳过 Levenshtein。
     */
    calculateHybridSimilarity(str1, str2, threshold = null) {
        const norm1 = this.normalizeText(str1);
        const norm2 = this.normalizeText(str2);

        if (!norm1 || !norm2) return 0;
        if (norm1 === norm2) return 1; // 快速返回完全匹配

        // 1. Jaccard (Token based)
        const tokens1 = new Set(norm1.split(/[\s\p{P}]+/u));
        const tokens2 = new Set(norm2.split(/[\s\p{P}]+/u));

        const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
        const union = new Set([...tokens1, ...tokens2]);

        const jaccard = intersection.size / union.size;

        // 性能优化: 提前剪枝
        // 公式: Score = 0.6 * Jaccard + 0.4 * Levenshtein
        // Levenshtein Max Score = 1.0 (完全相同)
        // Max Possible Score = 0.6 * Jaccard + 0.4
        // 如果 Max Possible Score < threshold，则必定无法满足条件，无需计算 Levenshtein
        if (threshold !== null) {
            const maxPossibleScore = (jaccard * 0.6) + 0.4;
            if (maxPossibleScore < threshold) {
                return maxPossibleScore; // 返回估算的低分
            }
        }

        // 2. Levenshtein (Char based) - 只有在有机会超过阈值时才计算
        const levDist = this.levenshteinDistance(norm1, norm2);
        const maxLength = Math.max(norm1.length, norm2.length);
        const levSim = 1 - (levDist / maxLength);

        return (jaccard * 0.6) + (levSim * 0.4);
    }

    normalizeText(text) {
        return text
            .toLowerCase()
            .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, '')
            .trim();
    }

    levenshteinDistance(str1, str2) {
        const len1 = str1.length;
        const len2 = str2.length;
        const dp = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

        for (let i = 0; i <= len1; i++) dp[i][0] = i;
        for (let j = 0; j <= len2; j++) dp[0][j] = j;

        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                if (str1[i - 1] === str2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1];
                } else {
                    dp[i][j] = Math.min(
                        dp[i - 1][j] + 1,
                        dp[i][j - 1] + 1,
                        dp[i - 1][j - 1] + 1
                    );
                }
            }
        }
        return dp[len1][len2];
    }
}
