// 通知推送模块 (简化版 - 只支持4种通知渠道)
export class NotificationService {
    constructor(config) {
        this.config = config;
    }

    // 发送通知到所有配置的渠道
    async sendNotifications(content, htmlContent) {
        const promises = [];

        console.log('📢 检查通知渠道配置...');

        if (this.config.FEISHU_WEBHOOK_URL) {
            console.log('  ✅ 飞书已配置');
            promises.push(this.sendFeishu(content));
        }

        if (this.config.DINGTALK_WEBHOOK_URL) {
            console.log('  ✅ 钉钉已配置');
            promises.push(this.sendDingtalk(content));
        }

        if (this.config.WEWORK_WEBHOOK_URL) {
            console.log('  ✅ 企业微信已配置');
            promises.push(this.sendWework(content));
        }

        if (this.config.TELEGRAM_BOT_TOKEN && this.config.TELEGRAM_CHAT_ID) {
            console.log('  ✅ Telegram已配置');
            promises.push(this.sendTelegram(content));
        }

        if (promises.length === 0) {
            console.log('  ⚠️  未配置任何通知渠道');
        }

        const results = await Promise.allSettled(promises);

        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                console.error(`  ❌ 通知发送失败:`, result.reason);
            }
        });

        return results;
    }

    // 飞书推送
    async sendFeishu(content) {
        const batches = this.splitMessage(content, this.config.FEISHU_BATCH_SIZE);

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const message = batches.length > 1
                ? `${batch}\n\n━━━━━━━━━━━━━━━━━━━\n第 ${i + 1}/${batches.length} 部分`
                : batch;

            await fetch(this.config.FEISHU_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    msg_type: 'text',
                    content: { text: message }
                })
            });

            if (i < batches.length - 1) {
                await this.sleep(this.config.BATCH_SEND_INTERVAL * 1000);
            }
        }
    }

    // 钉钉推送
    async sendDingtalk(content) {
        const batches = this.splitMessage(content, this.config.DINGTALK_BATCH_SIZE);

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const message = batches.length > 1
                ? `${batch}\n\n第 ${i + 1}/${batches.length} 部分`
                : batch;

            await fetch(this.config.DINGTALK_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    msgtype: 'text',
                    text: { content: message }
                })
            });

            if (i < batches.length - 1) {
                await this.sleep(this.config.BATCH_SEND_INTERVAL * 1000);
            }
        }
    }

    // 企业微信推送
    async sendWework(content) {
        const msgType = this.config.WEWORK_MSG_TYPE;
        const batches = this.splitMessage(content, this.config.MESSAGE_BATCH_SIZE);

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const message = batches.length > 1
                ? `${batch}\n\n第 ${i + 1}/${batches.length} 部分`
                : batch;

            const payload = msgType === 'markdown'
                ? {
                    msgtype: 'markdown',
                    markdown: { content: message }
                }
                : {
                    msgtype: 'text',
                    text: { content: this.stripMarkdown(message) }
                };

            await fetch(this.config.WEWORK_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (i < batches.length - 1) {
                await this.sleep(this.config.BATCH_SEND_INTERVAL * 1000);
            }
        }
    }

    // Telegram推送
    async sendTelegram(content) {
        const batches = this.splitMessage(content, this.config.MESSAGE_BATCH_SIZE);
        const url = `https://api.telegram.org/bot${this.config.TELEGRAM_BOT_TOKEN}/sendMessage`;

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const message = batches.length > 1
                ? `${batch}\n\n第 ${i + 1}/${batches.length} 部分`
                : batch;

            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.config.TELEGRAM_CHAT_ID,
                    text: message,
                    parse_mode: 'Markdown'
                })
            });

            if (i < batches.length - 1) {
                await this.sleep(this.config.BATCH_SEND_INTERVAL * 1000);
            }
        }
    }

    // 分割消息
    splitMessage(content, maxSize) {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(content);

        if (bytes.length <= maxSize) {
            return [content];
        }

        const batches = [];
        const lines = content.split('\n');
        let currentBatch = '';

        for (const line of lines) {
            const testBatch = currentBatch + (currentBatch ? '\n' : '') + line;
            const testBytes = encoder.encode(testBatch);

            if (testBytes.length > maxSize && currentBatch) {
                batches.push(currentBatch);
                currentBatch = line;
            } else {
                currentBatch = testBatch;
            }
        }

        if (currentBatch) {
            batches.push(currentBatch);
        }

        return batches;
    }

    // 去除Markdown格式
    stripMarkdown(text) {
        return text
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/\*(.*?)\*/g, '$1')
            .replace(/\[(.*?)\]\(.*?\)/g, '$1')
            .replace(/`(.*?)`/g, '$1')
            .replace(/#{1,6}\s/g, '');
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
