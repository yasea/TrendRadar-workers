export class HolidayService {
    constructor(config, kv) {
        this.config = config;
        this.kv = kv;
    }

    /**
     * 检查指定日期是否为节假日或周末
     * @param {Date} date 日期对象
     * @returns {Promise<boolean>} true=节假日/周末, false=工作日
     */
    async isHolidayOrWeekend(date) {
        const dateStr = this.formatDate(date); // YYYY-MM-DD
        const cacheKey = `holiday:${dateStr}`;

        // 1. 检查缓存
        const cachedStatus = await this.kv.get(cacheKey);
        if (cachedStatus !== null) {
            console.log(`📅 节假日缓存命中: ${dateStr} = ${cachedStatus}`);
            return cachedStatus === 'true';
        }

        // 2. 调用API查询
        try {
            const isHoliday = await this.fetchHolidayStatus(dateStr);

            // 3. 写入缓存 (过期时间设为24小时，或者直到当天结束)
            // 这里简单设为24小时，因为历史日期的状态不会变，未来日期的状态可能会变但短期内不太可能
            await this.kv.put(cacheKey, isHoliday.toString(), {
                expirationTtl: 86400
            });

            console.log(`📅 节假日API查询: ${dateStr} = ${isHoliday}`);
            return isHoliday;
        } catch (error) {
            console.error('❌ 获取节假日状态失败, 降级为普通周末判断:', error);
            // 降级处理：仅判断周末
            const day = date.getDay();
            return day === 0 || day === 6;
        }
    }

    /**
     * 调用聚合数据API查询
     * @param {string} dateStr YYYY-MM-DD
     * @returns {Promise<boolean>}
     */
    async fetchHolidayStatus(dateStr) {
        if (!this.config.JUHE_API_KEY) {
            console.warn('⚠️ 未配置 JUHE_API_KEY, 仅使用周末判断');
            const date = new Date(dateStr);
            const day = date.getDay();
            return day === 0 || day === 6;
        }

        const url = `https://apis.juhe.cn/fapig/calendar/day.php?date=${dateStr}&key=${this.config.JUHE_API_KEY}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();

        if (data.error_code !== 0) {
            throw new Error(`API error: ${data.reason} (${data.error_code})`);
        }

        const result = data.result;
        // status: 1:节假日，2:工作日
        // 如果 status 为 null，则需要结合 week 判断，或者直接视为普通日子（非调休非特定节假日）

        if (result.status === '1') {
            return true; // 节假日
        } else if (result.status === '2') {
            return false; // 工作日 (可能是周末调休)
        } else {
            // status 为 null 或其他，按周末判断
            // result.week: "一", "二", ... "日"
            // 也可以直接用 dateStr 判断
            const date = new Date(dateStr);
            const day = date.getDay();
            return day === 0 || day === 6;
        }
    }

    formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
}
