// 配置管理模块
export const DEFAULT_CONFIG = {
    VERSION: '1.0',
    REQUEST_INTERVAL: 1000,
    REPORT_MODE: 'incremental', // daily, current, incremental
    RANK_THRESHOLD: 5,
    SORT_BY_POSITION_FIRST: false,
    MAX_NEWS_PER_KEYWORD: 10,
    ENABLE_CRAWLER: true,
    ENABLE_NOTIFICATION: true,
    MESSAGE_BATCH_SIZE: 4000,
    DINGTALK_BATCH_SIZE: 20000,
    FEISHU_BATCH_SIZE: 30000,
    BATCH_SEND_INTERVAL: 3,

    // 权重配置
    WEIGHT_CONFIG: {
        RANK_WEIGHT: 0.6,
        FREQUENCY_WEIGHT: 0.3,
        HOTNESS_WEIGHT: 0.1
    },

    // 默认平台配置
    PLATFORMS: [
        { id: 'thepaper', name: '澎湃新闻' },
        { id: 'wallstreetcn-news', name: '华尔街见闻 最新' },
        { id: 'cls-depth', name: '财联社 深度' },
        { id: 'weibo', name: '微博' },
        { id: 'ithome', name: 'IT之家' },
        { id: 'github', name: 'GitHub' },
        { id: 'sspai', name: '少数派' },
        { id: 'hackernews', name: 'Hacker News' },
        { id: 'cankaoxiaoxi', name: '参考消息 军事' },
        { id: 'zaobao', name: '联合早报' }
    ],

    // 默认关键词
    DEFAULT_KEYWORDS: [
        'AI', '人工智能', '大模型', 'ChatGPT', 'OpenAI',
        'AGI', 'Sora', 'DeepSeek', 'Gemini', 'Claude',
        'NVIDIA', '英伟达', '黄仁勋', '微软', 'Microsoft',
        '谷歌', 'Google', '字节', '华为', '鸿蒙', '任正非',
        '阿里', '通义', '百度', '文心', '特斯拉', '马斯克',
        '自动驾驶', '机器人', '人形机器人', '大疆', '宇树',
        '芯片', '半导体', '台积电', '中芯国际', '苹果', 'iPhone', 'Mac',
        '中国', '美国', '日本', '韩国', '军事', '国防', '军工', '航母', '无人机',
        '航空航天', 'SpaceX', '星舰', '登月', '火星', '嫦娥', '天问', '国际关系', '地缘政治', '俄乌', '中东', '能源', '核能', '新质生产力', '健康', '医疗科技', '生物科技', '生命科学', '胖东来',
        '比亚迪', '新能源',
    ]
};

// 加载配置
export function loadConfig(env) {
    return {
        ...DEFAULT_CONFIG,
        VERSION: env.VERSION || DEFAULT_CONFIG.VERSION,
        ENABLE_CRAWLER: env.ENABLE_CRAWLER === 'true',
        ENABLE_NOTIFICATION: env.ENABLE_NOTIFICATION === 'true',
        REPORT_MODE: env.REPORT_MODE || DEFAULT_CONFIG.REPORT_MODE,

        // Webhook配置 (只保留4种通知渠道)
        FEISHU_WEBHOOK_URL: env.FEISHU_WEBHOOK_URL || '',
        DINGTALK_WEBHOOK_URL: env.DINGTALK_WEBHOOK_URL || '',
        WEWORK_WEBHOOK_URL: env.WEWORK_WEBHOOK_URL || '',
        WEWORK_MSG_TYPE: env.WEWORK_MSG_TYPE || 'markdown',
        TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN || '',
        TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID || '',

        // API Keys
        JUHE_API_KEY: env.JUHE_API_KEY || '',
        DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY || '',

        // 节假日推送时间 (北京时间)
        HOLIDAY_SCHEDULE_HOURS: [10, 12, 16, 20]
    };
}
