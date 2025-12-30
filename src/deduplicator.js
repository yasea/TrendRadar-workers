export class DeduplicationService {
    constructor(config, storage) {
        this.config = config;
        this.storage = storage;
        // 调试模式开关，本地运行时可开启
        this.debug = true; 
    }

    log(message, data = null) {
        if (this.debug) {
            if (data) {
                console.log(`[Dedupe] ${message}`, JSON.stringify(data, null, 0)); // Compact JSON
            } else {
                console.log(`[Dedupe] ${message}`);
            }
        }
    }

    /**
     * 新闻去重服务 (预处理 -> 严格去重 -> 算法去重 -> AI 语义去重)
     * @param {Array} newsList - 当前抓取的新闻列表 (待去重)
     * @param {Array} historyList - 历史新闻标题列表 (作为参考，用于增量去重)
     * @returns {Promise<Array>} - 去重后的新闻列表
     */
    async deduplicate(newsList, historyList = []) {
        if (!newsList || newsList.length === 0) return [];

        const startTime = Date.now();
        this.log(`🔍 开始去重流程: 输入 ${newsList.length} 条, 历史参考 ${historyList.length} 条`);

        // ==============================================================================
        // 0. 预处理 (CPU 优化核心)
        // ==============================================================================
        // 一次性计算所有 Token 和标准化文本，避免在 O(N^2) 循环中重复计算
        const preparedNews = this.prepareItems(newsList);
        const preparedHistory = this.prepareItems(historyList.map(title => ({ title, isHistory: true })));

        // ==============================================================================
        // 1. 严格 & 标准化去重 (Set 快速过滤)
        // ==============================================================================
        // 过滤掉:
        // A. 列表内部完全相同的标题
        // B. 列表内部标准化后相同的标题 (忽略标点/大小写)
        // C. 与历史记录完全/标准化相同的标题
        // ==============================================================================
        const uniqueItems = [];
        const seenSignatures = new Set();

        // 先把历史记录的签名加进去
        for (const h of preparedHistory) {
            seenSignatures.add(h.normalized);
        }

        for (const item of preparedNews) {
            if (seenSignatures.has(item.normalized)) {
                this.log(`🗑️ 严格去重: <${item.original.title}> 与已有/历史记录重复`);
                continue;
            }
            seenSignatures.add(item.normalized);
            uniqueItems.push(item);
        }

        this.log(`✅ 严格去重后剩余: ${uniqueItems.length} 条`);
        if (uniqueItems.length === 0) return [];


        // ==============================================================================
        // 2. 算法去重 (混合相似度)
        // ==============================================================================
        // 使用预处理好的数据进行比较，大幅降低 CPU
        this.log('🧮 阶段一: 算法去重 (Similarity > 0.8)...');
        const algoResult = this.deduplicateByAlgorithmOptimized(uniqueItems, preparedHistory, 0.8);
        this.log(`✅ 算法去重后剩余: ${algoResult.length} 条`);


        // 如果没有配置 AI，或数据量过大/为空，直接返回算法结果
        if (!this.config.DEEPSEEK_API_KEY || algoResult.length === 0) {
            this.log('未配置 AI 密钥或数据量过大/为空，跳过 AI 去重阶段');
            return algoResult.map(item => item.original);
        }

        try {
            // ==============================================================================
            // 3. 预筛选 (Pre-filter)
            // ==============================================================================
            // 挑选出"可疑"项发送给 AI，减少 Token 消耗
            const { itemsToCheck, safeItems, relevantHistory } = this.preFilterForAI(algoResult, preparedHistory, 0.1);

            if (itemsToCheck.length === 0) {
                this.log('✅ 预筛选完成: 未发现疑似重复项，无需 AI 介入');
                return safeItems.map(item => item.original);
            }

            this.log(`🤖 阶段二: AI 语义去重 | 待处理(疑似): ${itemsToCheck.length} 条 | 安全: ${safeItems.length} 条 | 上下文: ${relevantHistory.length} 条`);

            // ==============================================================================
            // 4. AI 语义去重
            // ==============================================================================
            // 注意：deduplicateByLLM 接收的是原始对象，所以需要 .map(item => item.original)
            // 但 relevantHistory 已经是 title 字符串数组了 (构造自 preparedHistory)
            const aiDedupedItems = await this.deduplicateByLLM(
                itemsToCheck.map(i => i.original),
                relevantHistory
            );

            const result = [...safeItems.map(i => i.original), ...aiDedupedItems];

            this.log(`🏁 去重完成, 最终数量: ${result.length}, 耗时: ${Date.now() - startTime}ms`);
            
            // 最后再做一次 Title Set 检查，确保万无一失 (防止 AI 返回结果合并时出错)
            const finalUnique = [];
            const finalSeen = new Set();
            for (const r of result) {
                // 简单的去重，只要标题不一样就行
                if(!finalSeen.has(r.title)) {
                    finalUnique.push(r);
                    finalSeen.add(r.title);
                }
            }
            return finalUnique;

        } catch (e) {
            console.error('[Dedupe] ⚠️ AI 阶段失败, 降级使用算法结果:', e);
            return algoResult.map(item => item.original);
        }
    }

    /**
     * 预处理列表项：生成 Normalized Text 和 Token Set
     * @param {Array} itemList 
     */
    prepareItems(itemList) {
        return itemList.map(item => {
            // 兼容 item 可能是 { title: "..." } 或直接是 item
            const title = item.title || item; 
            const normalized = this.normalizeText(title);
            return {
                original: item, // 保留原始引用
                title: title,
                normalized: normalized,
                tokens: this.getTokensFromNormalized(normalized), // 基于已标准化的文本分词
                length: normalized.length
            };
        });
    }

    /**
     * 优化版算法去重
     * @param {Array} preparedNews (带有 tokens 的对象列表)
     * @param {Array} preparedHistory (带有 tokens 的对象列表)
     * @param {number} threshold 
     */
    deduplicateByAlgorithmOptimized(preparedNews, preparedHistory, threshold = 0.6) {
        const deduplicated = [];
        const seen = []; // 存放 prepared item

        // 加载历史
        // 这里不需要把历史也放入 seen 参与"谁替换谁"的逻辑，因为历史永远保留
        // 我们只需要用历史来"过滤"新新闻
        // 为了性能，separate logic for history check
        
        for (const sortItem of preparedNews) {
            const newsTitle = sortItem.title;
            let isDuplicate = false;
            let maxSim = 0;
            let matchedSource = '';

            // 1. 检查历史记录
            for (const historyItem of preparedHistory) {
                // 长度差异过大 check (Levenshtein 优化)
                // 如果长度差超过 max(len1, len2) * (1-threshold)，则 similarity 不可能超过 threshold (对于 pure Levenshtein)
                // 混合算法包含 Jaccard，所以这里只要长度差不是极度离谱即可
                // 简单 heuristic: 长度差超过 50% 一般不可能是同语义新闻
                if (Math.abs(sortItem.length - historyItem.length) > Math.max(sortItem.length, historyItem.length) * 0.6) {
                    continue;
                }

                const sim = this.calculateHybridSimilarityOptimized(sortItem, historyItem, threshold);
                if (sim > threshold) {
                    isDuplicate = true;
                    matchedSource = `[历史] ${historyItem.title}`;
                    maxSim = sim;
                    break; // 和历史重复，直接判死刑
                }
            }

            if (isDuplicate) {
                this.log(`🗑️ 算法过滤 (Sim: ${maxSim.toFixed(2)}): "${newsTitle}" ~= "${matchedSource}"`);
                continue;
            }

            // 2. 检查当前批次已保留的 (Internal Check)
            for (let i = 0; i < seen.length; i++) {
                const seenItem = seen[i];
                
                // Length check
                if (Math.abs(sortItem.length - seenItem.length) > Math.max(sortItem.length, seenItem.length) * 0.6) {
                    continue;
                }

                const sim = this.calculateHybridSimilarityOptimized(sortItem, seenItem, threshold);

                if (sim > threshold) {
                    isDuplicate = true;
                    // 比较权重，保留好的
                    const currentWeight = sortItem.original.weight || 0;
                    const seenWeight = seenItem.original.weight || 0;

                    if (currentWeight > seenWeight) {
                        this.log(`🔄 替换更优版本 (Sim: ${sim.toFixed(2)}): 保留 "${newsTitle}" (替换 "${seenItem.title}")`);
                        // 替换 seen 中的 item
                        seen[i] = sortItem;
                        // 同时也要更新 deduplicated 数组 (找到对应 index)
                        // seen 和 deduplicated 是同步 append 的，所以 index 一样
                        deduplicated[i] = sortItem;
                    } else {
                        this.log(`🗑️ 丢弃较差版本 (Sim: ${sim.toFixed(2)}): 丢弃 "${newsTitle}" (保留 "${seenItem.title}")`);
                    }
                    break; 
                }
            }

            if (!isDuplicate) {
                deduplicated.push(sortItem);
                seen.push(sortItem);
            }
        }

        return deduplicated;
    }

    /**
     * 预筛选 AI (使用 Prepared Items)
     */
    preFilterForAI(preparedNews, preparedHistory, threshold) {
        const suspiciousIndices = new Set();
        const relevantHistorySet = new Set();

        // 1. History Check
        for (const historyItem of preparedHistory) {
            let isRelated = false;
            for (let i = 0; i < preparedNews.length; i++) {
                // 只计算 Jaccard 用于快速筛选，不跑 Levenshtein
                const jaccard = this.calculateJaccard(preparedNews[i].tokens, historyItem.tokens);
                if (jaccard > threshold) {
                    suspiciousIndices.add(i);
                    isRelated = true;
                    this.log(`⚠️  [AI预检] 历史疑似: "${preparedNews[i].title}" <~> "${historyItem.title}" (J: ${jaccard.toFixed(2)})`);
                }
            }
            if (isRelated) relevantHistorySet.add(historyItem.title);
        }

        // 2. Internal Check
        for (let i = 0; i < preparedNews.length; i++) {
            for (let j = i + 1; j < preparedNews.length; j++) {
                 // Optimization: if both are already marked suspicious, we *could* skip comparison,
                 // but we run it to ensure we catch internal duplicates even if not related to history.
                 // To save CPU: if BOTH are already suspicious, strict need to re-check is low unless we want debugging.
                 // Let's check anyway.
                 const jaccard = this.calculateJaccard(preparedNews[i].tokens, preparedNews[j].tokens);
                 if (jaccard > threshold) {
                     suspiciousIndices.add(i);
                     suspiciousIndices.add(j);
                     this.log(`⚠️  [AI预检] 内部疑似: "${preparedNews[i].title}" <~> "${preparedNews[j].title}" (J: ${jaccard.toFixed(2)})`);
                 }
            }
        }

        const itemsToCheck = preparedNews.filter((_, i) => suspiciousIndices.has(i));
        const safeItems = preparedNews.filter((_, i) => !suspiciousIndices.has(i));

        return {
            itemsToCheck,
            safeItems,
            relevantHistory: Array.from(relevantHistorySet).slice(0, 50)
        };
    }


    /**
     * 计算混合相似度 (使用预计算的 tokens)
     * @param {Object} item1 - Prepared Item
     * @param {Object} item2 - Prepared Item
     * @param {number} threshold 
     */
    calculateHybridSimilarityOptimized(item1, item2, threshold) {
        if (item1.normalized === item2.normalized) return 1.0;

        // 1. Jaccard
        const jaccard = this.calculateJaccard(item1.tokens, item2.tokens);

        // 2. Early Exit check
        // Max possible score = 0.6 * Jaccard + 0.4 * 1.0
        // 如果 Jaccard 只能贡献 max 0.6 的分数，还需要 Levenshtein 弥补。
        // 但如果 Jaccard 太低，使得 (Jaccard * 0.6 + 0.4 * 1.0) 都低于 threshold，那就算 Levenshtein 是 1 也救不回来。
        if (jaccard * 0.6 + 0.4 < threshold) {
            return jaccard * 0.6; 
        }

        // 3. Levenshtein (Expensive)
        // 剪枝: 只有 Jaccard 不算太低的时候才跑 Levenshtein
        const levDist = this.levenshteinDistance(item1.normalized, item2.normalized);
        const maxLength = Math.max(item1.length, item2.length);
        const levSim = maxLength === 0 ? 0 : (1 - (levDist / maxLength)); // Prevent divide by zero

        return (jaccard * 0.6) + (levSim * 0.4);
    }
    
    // --- Util Methods ---

    /**
     * 标准化: 转小写，只保留中文、数字、字母
     */
    normalizeText(text) {
        if(!text) return "";
        return text
            .toLowerCase()
            .replace(/[^\u4e00-\u9fa5a-z0-9]/g, '') // 移除空格和标点
            .trim();
    }

    /**
     * 从已标准化的文本中提取 Token
     * 策略: 中文单字 + 英文/数字 序列
     */
    getTokensFromNormalized(normalizedText) {
        if (!normalizedText) return new Set();
        // 匹配: [\u4e00-\u9fa5] (中文) OR [a-z0-9]+ (英文数字串)
        const matches = normalizedText.match(/[\u4e00-\u9fa5]|[a-z0-9]+/g) || [];
        return new Set(matches);
    }

    calculateJaccard(tokens1, tokens2) {
        if (tokens1.size === 0 || tokens2.size === 0) return 0;
        let intersection = 0;
        
        // Optimize: iterate smaller set
        const [smaller, larger] = tokens1.size < tokens2.size ? [tokens1, tokens2] : [tokens2, tokens1];
        
        for (const t of smaller) {
            if (larger.has(t)) intersection++;
        }
        
        const union = tokens1.size + tokens2.size - intersection;
        return union === 0 ? 0 : intersection / union;
    }

    levenshteinDistance(str1, str2) {
        // Space Optimized Levenshtein (2 rows)
        const len1 = str1.length;
        const len2 = str2.length;
        
        if (len1 > len2) return this.levenshteinDistance(str2, str1);

        let prevRow = Array(len1 + 1).fill(0).map((_, i) => i);
        let curRow = Array(len1 + 1).fill(0);

        for (let j = 1; j <= len2; j++) {
            curRow[0] = j;
            for (let i = 1; i <= len1; i++) {
                if (str1[i - 1] === str2[j - 1]) {
                    curRow[i] = prevRow[i - 1];
                } else {
                    curRow[i] = Math.min(prevRow[i], curRow[i - 1], prevRow[i - 1]) + 1;
                }
            }
            // Swap rows
            [prevRow, curRow] = [curRow, prevRow];
        }
        
        return prevRow[len1];
    }

    /**
     * 使用 LLM 识别重复项
     */
    async deduplicateByLLM(newsList, historyList) {
        // 构建简化列表
        const targetList = newsList.map((news, index) => ({
            id: index,
            title: news.title,
            source: news.source
        }));

        const contextList = historyList.map((title, index) => ({
            id: `h_${index}`,
            title: title
        }));

        const prompt = `
### 任务
你是一名专业的新闻数据清洗专家。请分析【待处理列表】中的新闻，并结合【历史参考列表】识别出其中的重复、冗余或过时内容。

### 去重判定标准 (智能识别)
1.  **完全语义重复**：描述同一时间、具体主体发生的相同事件（即使语言风格不同）。
    - 例：“特斯拉发布三季度财报” vs “Tesla Q3 earnings report released” -> **重复**。
2.  **包含关系（择优保留）**：如果两条新闻描述同一事件，保留信息量更大、细节更具体（含数字、具体人物、直接因果关系）的一条，删除简略的。
    - 例：“某大模型发布” vs “某大模型正式发布，支持100万上下文” -> **保留后者**。
3.  **历史记录冲突**：如果【待处理列表】的新闻在【历史参考列表】中已存在，且没有实质性的“新进展”或“深层变化”，则视为冗余。
    - **注意**：同一事件的后续重大演进不算重复（如：“火箭已发射” vs “火箭已成功着陆”）。
4.  **汇总 vs 单项**：若一条新闻是多项新闻的汇总报道，且单项报道在列表中也存在，根据重要性选择。

### 输出格式
必须返回纯 JSON，格式如下：
{
  "remove_ids": [id1, id2, ...],
  "analysis": "简要说明去重理由(可选)"
}

### 输入数据
【历史参考列表】(仅供参考其内容，不在此列表上做删除):
${JSON.stringify(contextList)}

【待处理列表】(需从中识别出应删除的 ID):
${JSON.stringify(targetList)}
`;

        this.log('📤 发送 AI 请求, Prompt length:', prompt.length);

        const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: "deepseek-v3.2",
                messages: [
                    {
                        role: "system",
                        content: "你是一个只输出 JSON 的高精尖去重助手。你擅长分析新闻的演进关系、语义颗粒度，并能精准识别历史冗余，确保新闻流的唯一性和高质量。"
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
        
        if (this.storage && data.usage) {
             this.storage.logTokenUsage('deduplicator', data.model, data.usage, {
                itemCount: newsList.length,
                historyCount: historyList.length
            }).catch(() => {});
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
            console.error('[Dedupe] LLM parse error:', content);
            throw e;
        }

        this.log(`🤖 LLM 建议移除 ID:`, removeIds);

        const removeSet = new Set(removeIds.map(id => Number(id)));
        return newsList.filter((_, index) => !removeSet.has(index));
    }
}
