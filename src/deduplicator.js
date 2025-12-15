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

        // 1. 第一阶段:算法去重
        // 这样可以大幅减少传给 AI 的 token 数量
        console.log('🧮 阶段一: 使用算法 (Similarity > 0.8) 去除明显重复项...');
        const algoResult = this.deduplicateByAlgorithm(newsList, historyList, 0.8);

        // 如果没有配置 AI，或数据量过大/为空，直接返回算法结果
        if (!this.config.DEEPSEEK_API_KEY || algoResult.length === 0) {
            console.log('未配置 AI 密钥或数据量过大/为空，跳过 AI 去重阶段');
            return algoResult;
        }

        // 限制 AI 处理的最大数量，避免超时或 excessive cost
        if (algoResult.length > 200) {
            console.log('⚠️ 待处理数据过多 (>200)，跳过 AI 去重阶段');
            return algoResult;
        }

        try {
            // 2. 预筛选: 区分"安全"与"可疑"数据
            // 只将与历史记录或批次内其他数据有一定关联的"可疑"项发给 AI
            // 这里的阈值(0.3)设定得较低，确保宁可错杀(发给AI)也不漏放(直接发布重复项)
            const { itemsToCheck: suspiciousItems, safeItems, relevantHistory } = this.preFilterForAI(algoResult, historyList, 0.3);

            if (suspiciousItems.length === 0) {
                console.log('✅ 预筛选完成: 未发现疑似重复项，无需 AI 介入');
                return safeItems;
            }

            console.log(`🤖 阶段二: DeepSeek 语义去重 | 待处理(疑似): ${suspiciousItems.length} 条 | 安全(跳过): ${safeItems.length} 条 | 上下文: ${relevantHistory.length} 条`);

            // 3. 第二阶段: LLM 语义去重 (仅针对可疑项)
            const aiDedupedItems = await this.deduplicateByLLM(suspiciousItems, relevantHistory);

            // 4. 合并结果
            // safeItems 是肯定不重复的，aiDedupedItems 是经过 AI 筛选剩下的
            // 保持相对顺序: 将 safeItems 和 aiDedupedItems 合并并按原顺序(如果需要)或者直接追加
            // 简单追加即可，通常顺序不是严格约束
            return [...safeItems, ...aiDedupedItems];

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
     * @param {number} threshold - 相似度阈值 (默认 0.6)
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
     * 预筛选 AI 处理列表
     * 通过低阈值算法检查，区分"安全"(Unique)和"可疑"(Potential Duplicate)数据
     * 同时收集相关的历史上下文
     */
    preFilterForAI(newsList, historyList, threshold = 0.3) {
        const suspiciousIndices = new Set();
        const relevantHistory = new Set();

        // 预分词，避免重复计算
        const newsTokens = newsList.map(news => this.getTokens(news.title));

        // 1. 检查与历史记录的关联 (History vs News)
        if (historyList && historyList.length > 0) {
            for (const historyTitle of historyList) {
                const historyTokens = this.getTokens(historyTitle);
                if (historyTokens.size === 0) continue;

                let isHistoryRelevant = false;

                for (let i = 0; i < newsTokens.length; i++) {
                    const nTokens = newsTokens[i];
                    if (nTokens.size === 0) continue;

                    // 快速 Jaccard 计算
                    const jaccard = this.calculateJaccard(nTokens, historyTokens);

                    if (jaccard > threshold) {
                        suspiciousIndices.add(i);
                        isHistoryRelevant = true;
                        // 注意: 不break! 一个历史标题可能对应多条新闻，都需要标记为可疑
                    }
                }

                if (isHistoryRelevant) {
                    relevantHistory.add(historyTitle);
                    if (relevantHistory.size >= 50) break; // 防止上下文过大
                }
            }
        }

        // 2. 检查批次内部关联 (News vs News)
        // 任何有内部相似性的对，都必须交给 AI 决断保留哪一个
        for (let i = 0; i < newsTokens.length; i++) {
            for (let j = i + 1; j < newsTokens.length; j++) {
                // 性能优化: 如果两项都已经标记为可疑，通常不需要再检查它们之间的相似性来增加 suspicious 标记
                // 但为了严谨(比如它们虽然都和 History 无关，但彼此相似)，还是建议检查。
                // 考虑到 n 通常很小 (< 50)，O(n^2) 的 Jaccard 开销可以接受
                const score = this.calculateJaccard(newsTokens[i], newsTokens[j]);
                if (score > threshold) {
                    suspiciousIndices.add(i);
                    suspiciousIndices.add(j);
                }
            }
        }

        const itemsToCheck = newsList.filter((_, i) => suspiciousIndices.has(i));
        const safeItems = newsList.filter((_, i) => !suspiciousIndices.has(i));

        return {
            itemsToCheck,
            safeItems,
            relevantHistory: Array.from(relevantHistory)
        };
    }

    getTokens(text) {
        const norm = this.normalizeText(text);
        return new Set(norm.split(/[\s\p{P}]+/u).filter(t => t.length > 0));
    }

    calculateJaccard(tokens1, tokens2) {
        if (tokens1.size === 0 || tokens2.size === 0) return 0;
        let intersection = 0;
        // 遍历较小的集合以提高效率
        const [smaller, larger] = tokens1.size < tokens2.size ? [tokens1, tokens2] : [tokens2, tokens1];

        for (const t of smaller) {
            if (larger.has(t)) intersection++;
        }
        const union = tokens1.size + tokens2.size - intersection;
        return intersection / union;
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
