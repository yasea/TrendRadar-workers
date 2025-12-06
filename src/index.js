// TrendRadar - Cloudflare Workers 版本
// 主入口文件

import { loadConfig } from './config.js';
import { DataFetcher } from './fetcher.js';
import { DataProcessor } from './processor.js';
import { NotificationService } from './notification.js';
import { StorageManager } from './storage.js';
import { HtmlGenerator } from './html.js';
import { HolidayService } from './holiday.js';
import { TranslationService } from './translator.js';

export default {
    // 定时触发 (Cron Trigger)
    scheduled(event, env, ctx) {
        ctx.waitUntil((async () => {
            console.log('[CRON]定时任务触发:', new Date().toISOString());

            try {
                const result = await handleCrawl(env);
                console.log('[CRON]定时任务完成:', result);
            } catch (error) {
                console.error('[CRON]定时任务失败:', error);
            }
        })());
    },

    // HTTP请求处理
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        try {
            // 路由处理
            if (path === '/' || path === '/index.html') {
                return await handleIndex(env);
            } else if (path === '/api/crawl') {
                return await handleApiCrawl(request, env);
            } else if (path === '/api/push') {
                return await handleApiPush(request, env);
            } else if (path === '/api/keywords') {
                return await handleKeywords(request, env);
            } else if (path === '/api/config') {
                return await handleConfig(request, env);
            } else if (path === '/api/logs') {
                return await handleLogs(request, env);
            } else {
                return new Response('Not Found', { status: 404 });
            }
        } catch (error) {
            console.error('请求处理失败:', error);
            return new Response(JSON.stringify({
                error: error.message,
                stack: error.stack
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
};

// 处理首页请求
async function handleIndex(env) {
    const storage = new StorageManager(env.TRENDRADAR_KV);
    const config = loadConfig(env);

    const todayNews = await storage.getTodayNews();

    if (!todayNews) {
        return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>TrendRadar</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
            color: white;
          }
          .container {
            text-align: center;
            padding: 40px;
          }
          h1 { font-size: 48px; margin: 0 0 20px 0; }
          p { font-size: 18px; opacity: 0.9; }
          .btn {
            display: inline-block;
            margin-top: 30px;
            padding: 12px 24px;
            background: white;
            color: #4f46e5;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🚀 TrendRadar</h1>
          <p>暂无新闻数据</p>
          <p>请先运行爬虫或等待定时任务执行</p>
          <a href="/api/crawl?force=1" class="btn">立即抓取</a>
        </div>
      </body>
      </html>
    `, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    }

    const htmlGenerator = new HtmlGenerator(config);
    const html = htmlGenerator.generateHtml(todayNews.matchedNews, todayNews.reportInfo);

    return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
}

// 处理爬虫API请求
async function handleApiCrawl(request, env) {
    const url = new URL(request.url);
    const force = url.searchParams.get('force') === '1';
    const result = await handleCrawl(env, force);

    return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
}

// 核心爬虫逻辑
async function handleCrawl(env, forcePush = false) {
    const config = loadConfig(env);
    const storage = new StorageManager(env.TRENDRADAR_KV);
    const fetcher = new DataFetcher(config);
    const processor = new DataProcessor(config);
    const notifier = new NotificationService(config);
    const holidayService = new HolidayService(config, env.TRENDRADAR_KV);
    const translationService = new TranslationService(config, env.TRENDRADAR_KV);

    const startTime = Date.now();
    console.log('========================================');
    console.log('🚀 开始抓取新闻...', new Date().toISOString());
    console.log('配置信息:', {
        REPORT_MODE: config.REPORT_MODE,
        ENABLE_CRAWLER: config.ENABLE_CRAWLER,
        ENABLE_NOTIFICATION: config.ENABLE_NOTIFICATION,
        PLATFORMS_COUNT: config.PLATFORMS.length,
        HAS_WEWORK_WEBHOOK: !!config.WEWORK_WEBHOOK_URL
    });

    // 1. 检查节假日推送限制 (仅针对定时任务，forcePush为false时)
    if (!forcePush && config.ENABLE_NOTIFICATION) {
        const beijingTime = processor.getBeijingTime();
        const hour = beijingTime.getHours();

        // 检查是否为节假日/周末
        const isHoliday = await holidayService.isHolidayOrWeekend(beijingTime);

        if (isHoliday) {
            console.log(`📅 今日是节假日/周末 (Hour: ${hour})`);
            // 检查当前小时是否在允许推送的时间列表中
            if (!config.HOLIDAY_SCHEDULE_HOURS.includes(hour)) {
                console.log(`⏸️ 节假日非推送时间 (${hour}点), 跳过执行`);
                return { success: true, message: '节假日非推送时间, 跳过执行' };
            }
            console.log(`✅ 节假日推送时间点 (${hour}点), 继续执行`);
        } else {
            console.log('📅 今日是工作日, 正常执行');
        }
    }

    if (!config.ENABLE_CRAWLER) {
        console.log('❌ 爬虫功能已禁用');
        return { success: false, message: '爬虫功能已禁用' };
    }

    console.log('📡 开始抓取', config.PLATFORMS.length, '个平台...');
    const { results, idToName, failedIds } = await fetcher.crawlWebsites(config.PLATFORMS);

    console.log('✅ 抓取完成:', {
        成功平台数: Object.keys(results).length,
        失败平台数: failedIds.length,
        失败平台: failedIds
    });

    if (Object.keys(results).length === 0) {
        console.log('❌ 未获取到任何数据');
        return { success: false, message: '未获取到任何数据' };
    }



    const keywordsText = await storage.getKeywords();
    const { groups: keywordGroups, filterWords } = processor.parseKeywords(keywordsText);

    if (keywordGroups.length === 0) {
        console.log('未配置关键词,使用全部新闻');
    }

    // 处理新闻 (匹配关键词)
    const matchedNews = processor.processNews(results, idToName, keywordGroups, filterWords);

    // 3. 对匹配后的新闻进行翻译
    // 这样可以节省Token，只翻译感兴趣的新闻
    for (const groupKey in matchedNews) {
        const newsList = matchedNews[groupKey];
        if (newsList.length > 0) {
            await translationService.translateNewsList(newsList);
        }
    }

    let totalNews = 0;
    let hotNews = 0;
    for (const newsList of Object.values(matchedNews)) {
        totalNews += newsList.length;
        hotNews += newsList.filter(n => n.count >= 3).length;
    }

    const beijingTime = processor.getBeijingTime();
    const reportInfo = {
        reportMode: config.REPORT_MODE,
        totalNews,
        hotNews,
        generateTime: processor.formatTime(beijingTime),
        generateDate: processor.formatDate(beijingTime)
    };

    await storage.saveTodayNews({ matchedNews, reportInfo });

    let notificationSent = false;
    let pushReason = '';

    if (config.ENABLE_NOTIFICATION) {
        console.log('📢 准备发送通知...');

        // 默认推送所有匹配的新闻
        let newsToPush = matchedNews;

        let shouldPush = forcePush;

        if (config.REPORT_MODE === 'incremental') {
            const historyTitles = await storage.getHistoryTitles();

            const { filteredNews, newNewsCount, currentTitles, newTitles } = filterNewsByHistory(matchedNews, historyTitles);

            shouldPush = newNewsCount > 0;
            pushReason = shouldPush ? `发现${newNewsCount}条新内容` : '无新内容';

            if (shouldPush) {
                newsToPush = filteredNews;
            }

            console.log('🔍 增量检查 (7天去重):', {
                历史标题数: historyTitles.size || 0,
                当前标题数: currentTitles.size,
                新增标题数: newNewsCount,
                是否推送: shouldPush,
                新增示例: newTitles.slice(0, 3).map(t => t.substring(0, 30) + '...')
            });

            // 保存当前标题到历史记录（无论是否推送都保存）
            await storage.saveHistoryTitles(Array.from(currentTitles));
        } else {
            shouldPush = true;
            pushReason = `${config.REPORT_MODE}模式自动推送`;
            console.log('✅ 模式:', config.REPORT_MODE, '- 总是推送');
        }

        if (shouldPush) {
            console.log('📤 开始发送通知...');
            try {
                // 生成推送内容
                const textContent = generateTextReport(newsToPush, reportInfo);
                console.log('📝 生成的报告长度:', textContent.length, '字符');

                const notifyResults = await notifier.sendNotifications(textContent, null);
                console.log('✅ 通知发送完成:', notifyResults);
                await storage.savePushRecord(config.REPORT_MODE);
                notificationSent = true;
            } catch (error) {
                console.error('❌ 通知发送失败:', error);
                throw error;
            }
        } else {
            console.log('⏭️  跳过推送:', pushReason);
        }
    } else {
        console.log('⚠️  通知功能已禁用');
    }

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    console.log('========================================');
    console.log('✅ 任务完成! 耗时:', duration, '秒');
    console.log('========================================');

    return {
        success: true,
        message: '抓取成功',
        data: {
            totalNews,
            hotNews,
            platforms: Object.keys(results).length,
            failedPlatforms: failedIds.length,
            notificationSent,
            pushReason,
            duration: duration + '秒'
        }
    };
}

// 生成文本报告 (优化版 - 合并所有新闻并去重)
function generateTextReport(matchedNews, reportInfo) {
    const { reportMode, totalNews, hotNews, generateTime } = reportInfo;
    const reportModeText = {
        'daily': '当日汇总',
        'current': '当前榜单',
        'incremental': '增量监控'
    }[reportMode] || reportMode;

    // 收集所有新闻
    const allNews = [];
    for (const newsList of Object.values(matchedNews)) {
        allNews.push(...newsList);
    }

    // 语义去重 (基于标题相似度)
    const deduplicatedNews = deduplicateNewsByTitle(allNews);

    // 按权重排序
    deduplicatedNews.sort((a, b) => (b.weight || 0) - (a.weight || 0));

    // 生成推送内容
    let text = `🔥 热点新闻推送\n\n`;
    text += ` ${deduplicatedNews.length}条 |  ${generateTime}\n`;
    // text += `━━━━━━━━━━━━━━━━━━━\n\n`;

    deduplicatedNews.forEach((news, index) => {
        // 格式: 序号.[新闻标题](链接) - 来源平台
        if (news.url) {
            text += `${index + 1}. [${news.title}](${news.url}) - ${news.source}\n`;
        } else {
            text += `${index + 1}. ${news.title} - ${news.source}\n`;
        }
    });

    return text;
}

// 新闻去重函数 (基于标题相似度 - 使用Levenshtein Distance)
function deduplicateNewsByTitle(newsList) {
    if (newsList.length === 0) return [];

    const deduplicated = [];
    const seen = [];

    for (const news of newsList) {
        const title = news.title;

        let isDuplicate = false;
        for (let i = 0; i < seen.length; i++) {
            const seenNews = seen[i];
            const seenTitle = seenNews.title;

            // 使用改进的相似度算法
            const similarity = calculateStringSimilarity(title, seenTitle);

            // 相似度阈值调整为0.7 (更严格的匹配)
            if (similarity > 0.7) {
                isDuplicate = true;
                if ((news.weight || 0) > (seenNews.weight || 0)) {
                    deduplicated[i] = news;
                    seen[i] = news;
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

// Levenshtein Distance (编辑距离) 算法
function levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;

    // 创建二维数组
    const dp = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

    // 初始化第一行和第一列
    for (let i = 0; i <= len1; i++) dp[i][0] = i;
    for (let j = 0; j <= len2; j++) dp[0][j] = j;

    // 动态规划计算编辑距离
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,      // 删除
                    dp[i][j - 1] + 1,      // 插入
                    dp[i - 1][j - 1] + 1   // 替换
                );
            }
        }
    }

    return dp[len1][len2];
}

// 预处理字符串: 移除标点符号、空格等，保留字母数字和中文
function normalizeText(text) {
    return text
        .toLowerCase()
        .replace(/[^\u4e00-\u9fa5a-z0-9]/g, '') // 只保留中文、字母、数字
        .trim();
}

// 过滤新闻 (基于历史记录)
function filterNewsByHistory(matchedNews, historyTitles) {
    const normalizedHistory = new Set();
    if (historyTitles && historyTitles.size > 0) {
        for (const t of historyTitles) {
            normalizedHistory.add(normalizeText(t));
        }
    }

    const filteredNews = {};
    let newNewsCount = 0;
    const currentTitles = new Set();
    const newTitles = [];

    for (const [platformId, newsList] of Object.entries(matchedNews)) {
        const newItems = [];
        for (const news of newsList) {
            currentTitles.add(news.title);
            const normalized = normalizeText(news.title);

            // 1. 检查完全匹配
            // 2. 检查标准化匹配
            if (!historyTitles.has(news.title) && !normalizedHistory.has(normalized)) {
                newItems.push(news);
                newTitles.push(news.title);
            }
        }

        if (newItems.length > 0) {
            filteredNews[platformId] = newItems;
            newNewsCount += newItems.length;
        }
    }

    return {
        filteredNews,
        newNewsCount,
        currentTitles,
        newTitles
    };
}

// 计算字符串相似度 (基于Levenshtein Distance)
function calculateStringSimilarity(str1, str2) {
    // 预处理: 标准化文本
    const normalized1 = normalizeText(str1);
    const normalized2 = normalizeText(str2);

    // 如果有一个为空，相似度为0
    if (!normalized1 || !normalized2) {
        return 0;
    }

    // 计算编辑距离
    const distance = levenshteinDistance(normalized1, normalized2);

    // 计算相似度: 1 - (距离 / 最大长度)
    const maxLength = Math.max(normalized1.length, normalized2.length);
    const similarity = 1 - (distance / maxLength);

    return similarity;
}

// 处理关键词API
async function handleKeywords(request, env) {
    const storage = new StorageManager(env.TRENDRADAR_KV);

    if (request.method === 'GET') {
        const keywords = await storage.getKeywords();
        return new Response(keywords, {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    } else if (request.method === 'POST') {
        const keywords = await request.text();
        await storage.saveKeywords(keywords);
        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    return new Response('Method Not Allowed', { status: 405 });
}

// 处理配置API
async function handleConfig(request, env) {
    const config = loadConfig(env);

    const safeConfig = {
        VERSION: config.VERSION,
        REPORT_MODE: config.REPORT_MODE,
        PLATFORMS: config.PLATFORMS,
        ENABLE_CRAWLER: config.ENABLE_CRAWLER,
        ENABLE_NOTIFICATION: config.ENABLE_NOTIFICATION,
        HAS_WEWORK_WEBHOOK: !!config.WEWORK_WEBHOOK_URL,
        HAS_FEISHU_WEBHOOK: !!config.FEISHU_WEBHOOK_URL,
        HAS_DINGTALK_WEBHOOK: !!config.DINGTALK_WEBHOOK_URL,
        HAS_TELEGRAM_CONFIG: !!(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID)
    };

    return new Response(JSON.stringify(safeConfig, null, 2), {
        headers: { 'Content-Type': 'application/json' }
    });
}

// 处理手动推送API
async function handleApiPush(request, env) {
    console.log('🔔 收到手动推送请求');

    const storage = new StorageManager(env.TRENDRADAR_KV);
    const config = loadConfig(env);
    const notifier = new NotificationService(config);

    const todayNews = await storage.getTodayNews();

    if (!todayNews) {
        console.log('❌ 没有可推送的数据');
        return new Response(JSON.stringify({
            success: false,
            message: '没有可推送的数据,请先运行爬虫'
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }

    if (!config.ENABLE_NOTIFICATION) {
        console.log('❌ 通知功能已禁用');
        return new Response(JSON.stringify({
            success: false,
            message: '通知功能已禁用'
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }

    const url = new URL(request.url);
    const force = url.searchParams.get('force') === '1';

    try {
        // 默认推送所有
        let newsToPush = todayNews.matchedNews;

        // 如果是增量模式，也进行去重检查
        if (config.REPORT_MODE === 'incremental') {
            console.log('🔍 手动推送 - 执行增量检查...');
            const historyTitles = await storage.getHistoryTitles();
            const { filteredNews, newNewsCount, currentTitles } = filterNewsByHistory(todayNews.matchedNews, historyTitles);

            if (newNewsCount === 0) {
                console.log('⚠️ 没有新内容，跳过推送');
                return new Response(JSON.stringify({
                    success: false,
                    message: '没有新内容 (所有内容均已在7天内推送过)'
                }), {
                    status: 200, // 返回200避免报错，但告知原因
                    headers: { 'Content-Type': 'application/json; charset=utf-8' }
                });
            }

            newsToPush = filteredNews;
            console.log(`✅ 发现 ${newNewsCount} 条新内容，准备推送`);

            // 保存历史记录! (关键: 手动推送也要更新历史，否则下次还会推)
            await storage.saveHistoryTitles(Array.from(currentTitles));
        }

        const textContent = generateTextReport(newsToPush, todayNews.reportInfo);
        console.log('📝 生成报告,长度:', textContent.length, '字符');

        console.log('📤 开始发送通知...');
        const results = await notifier.sendNotifications(textContent, null);
        console.log('✅ 通知发送完成:', results);

        await storage.savePushRecord('manual');

        return new Response(JSON.stringify({
            success: true,
            message: '推送成功',
            data: {
                totalNews: todayNews.reportInfo.totalNews,
                hotNews: todayNews.reportInfo.hotNews,
                contentLength: textContent.length,
                results: results.map(r => ({
                    status: r.status,
                    reason: r.reason || 'success'
                }))
            }
        }), {
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    } catch (error) {
        console.error('❌ 推送失败:', error);
        return new Response(JSON.stringify({
            success: false,
            message: '推送失败: ' + error.message,
            error: error.stack
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }
}

// 查看日志接口
async function handleLogs(request, env) {
    const storage = new StorageManager(env.TRENDRADAR_KV);

    const logs = [];
    const today = new Date();

    for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateKey = date.toISOString().split('T')[0].replace(/-/g, '');

        try {
            const record = await storage.kv.get(`push:${dateKey}`);
            if (record) {
                logs.push({
                    date: dateKey,
                    ...JSON.parse(record)
                });
            }
        } catch (e) {
            // 忽略错误
        }
    }

    return new Response(JSON.stringify({
        success: true,
        logs,
        count: logs.length
    }, null, 2), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
}
