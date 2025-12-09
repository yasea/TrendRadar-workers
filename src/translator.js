export class TranslationService {
    constructor(config, storage) {
        this.config = config;
        this.storage = storage;
        this.kv = storage.kv; // 兼容旧代码引用
        this.memoryCache = new Map(); // 内存缓存，避免同一次执行中重复查询KV
    }

    /**
     * 翻译文本 (带缓存)
     * @param {string} text 原文
     * @returns {Promise<string>} 译文
     */
    async translate(text) {
        if (!text || !this.isEnglish(text)) {
            return text;
        }

        if (!this.config.DEEPSEEK_API_KEY) {
            return text;
        }

        try {
            const hash = await this.digestMessage(text);

            // 0. 检查内存缓存
            if (this.memoryCache.has(hash)) {
                return this.memoryCache.get(hash);
            }

            const cacheKey = `trans:${hash}`;

            // 1. 检查KV缓存
            const cached = await this.kv.get(cacheKey);
            if (cached) {
                this.memoryCache.set(hash, cached);
                return cached;
            }

            // 2. 调用API
            // console.log('Translating:', text);
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
                            content: "你是一个专业的科技新闻翻译助手。请将用户提供的英文新闻标题翻译成中文。要求：\n1. 翻译准确、信达雅，符合中文阅读习惯。\n2. 保持科技新闻的专业性，专有名词(如AI, LLM, GPU等)保留英文。\n3. 仅返回翻译后的结果，不要包含任何解释、标点符号以外的额外文字。\n4. 如果原文已经是中文，原样返回。"
                        },
                        { role: "user", content: text }
                    ],
                    temperature: 0.1, // 降低温度，保持稳定
                    stream: false
                })
            });

            if (!response.ok) {
                throw new Error(`Translation API failed: ${response.status}`);
            }

            const data = await response.json();
            let translated = data.choices[0]?.message?.content?.trim();

            // 记录 Token 消耗
            if (data.usage) {
                this.storage.logTokenUsage('translator', data.model, data.usage, {
                    textLength: text.length
                }).catch(e => console.error('Token logging failed:', e));
            }

            // 去除可能的多余引号
            if (translated && (translated.startsWith('"') && translated.endsWith('"'))) {
                translated = translated.slice(1, -1);
            }

            if (translated) {
                // 3. 写入缓存 (30天)
                await this.kv.put(cacheKey, translated, {
                    expirationTtl: 86400 * 30
                });
                this.memoryCache.set(hash, translated);
                return translated;
            }

            return text;
        } catch (error) {
            console.error('Translation error:', error);
            return text;
        }
    }

    /**
     * 批量翻译新闻列表
     * @param {Array} newsList 新闻列表
     */
    async translateNewsList(newsList) {
        // 使用 Set 去重，避免重复翻译相同的标题
        const uniqueTitles = new Set();
        newsList.forEach(news => {
            if (this.isEnglish(news.title)) {
                uniqueTitles.add(news.title);
            }
        });

        // 预热缓存：并发翻译所有唯一标题
        const translationMap = new Map();
        const promises = Array.from(uniqueTitles).map(async (title) => {
            const translated = await this.translate(title);
            translationMap.set(title, translated);
        });

        await Promise.all(promises);

        // 应用翻译结果
        for (const news of newsList) {
            if (translationMap.has(news.title)) {
                const translated = translationMap.get(news.title);
                if (translated !== news.title) {
                    news.title = translated;
                }
            }
        }
    }

    /**
     * 检测是否为英文 (不包含中文字符 且 包含英文字母)
     */
    isEnglish(text) {
        // 1. 不包含中文字符
        // 2. 至少包含一个英文字母 (避免纯数字或符号被误判)
        return !/[\u4e00-\u9fa5]/.test(text) && /[a-zA-Z]/.test(text);
    }

    /**
     * 生成文本哈希 (SHA-256)
     */
    async digestMessage(message) {
        const msgUint8 = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
}
