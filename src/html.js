// HTML生成模块
export class HtmlGenerator {
  constructor(config) {
    this.config = config;
  }

  // 生成HTML报告
  generateHtml(matchedNews, reportInfo) {
    const { reportMode, totalNews, hotNews, generateTime } = reportInfo;

    let newsHtml = '';
    let groupIndex = 1;

    for (const [groupKey, newsList] of Object.entries(matchedNews)) {
      if (newsList.length === 0) continue;

      const countClass = newsList.length >= 20 ? 'hot' : (newsList.length >= 10 ? 'warm' : '');

      newsHtml += `
        <div class="word-group">
          <div class="word-header">
            <div class="word-info">
              <div class="word-name">${this.escapeHtml(groupKey)}</div>
              <div class="word-count ${countClass}">${newsList.length} 条</div>
            </div>
            <div class="word-index">${groupIndex}/${Object.keys(matchedNews).length}</div>
          </div>
      `;

      newsList.forEach((news, index) => {
        const isNew = news.isNew ? 'new' : '';
        const rankClass = news.firstRank <= 3 ? 'top' : (news.firstRank <= 10 ? 'high' : '');

        newsHtml += `
          <div class="news-item ${isNew}">
            <div class="news-number">${index + 1}</div>
            <div class="news-content">
              <div class="news-header">
                <span class="source-name">${this.escapeHtml(news.source)}</span>
                <span class="rank-num ${rankClass}">${news.firstRank}</span>
                <span class="time-info">${generateTime}</span>
              </div>
              <div class="news-title">
                ${news.url ? `<a href="${news.url}" target="_blank" class="news-link">${this.escapeHtml(news.title)}</a>` : this.escapeHtml(news.title)}
              </div>
            </div>
          </div>
        `;
      });

      newsHtml += `</div>`;
      groupIndex++;
    }

    return this.getHtmlTemplate(newsHtml, reportInfo);
  }

  // HTML模板
  getHtmlTemplate(content, reportInfo) {
    const { reportMode, totalNews, hotNews, generateTime } = reportInfo;
    const reportModeText = {
      'daily': '当日汇总',
      'current': '当前榜单',
      'incremental': '增量监控'
    }[reportMode] || reportMode;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TrendRadar - 热点新闻分析</title>
  <style>
    * { box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      margin: 0; 
      padding: 16px; 
      background: #fafafa;
      color: #333;
      line-height: 1.5;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 16px rgba(0,0,0,0.06);
    }
    .header {
      background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
      color: white;
      padding: 20px;
      text-align: center;
    }
    .header-title {
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 20px 0;
    }
    .header-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      font-size: 14px;
    }
    .info-item {
      text-align: center;
    }
    .info-label {
      display: block;
      font-size: 12px;
      opacity: 0.8;
      margin-bottom: 4px;
    }
    .info-value {
      font-weight: 600;
      font-size: 16px;
    }
    .content {
      padding: 24px;
    }
    .word-group {
      margin-bottom: 40px;
    }
    .word-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      padding-bottom: 8px;
      border-bottom: 1px solid #f0f0f0;
    }
    .word-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .word-name {
      font-size: 17px;
      font-weight: 600;
      color: #1a1a1a;
      max-width: 480px;
    }
    .word-count {
      color: #666;
      font-size: 13px;
      font-weight: 500; 
    }
    .word-count.hot { color: #dc2626; font-weight: 600; }
    .word-count.warm { color: #ea580c; font-weight: 600; }
    .word-index {
      color: #999;
      font-size: 12px;
    }
    .news-item {
      margin-bottom: 20px;
      padding: 16px 0;
      border-bottom: 1px solid #f5f5f5;
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .news-item.new::after {
      content: "NEW";
      position: absolute;
      top: 12px;
      right: 0;
      background: #fbbf24;
      color: #92400e;
      font-size: 9px;
      font-weight: 700;
      padding: 3px 6px;
      border-radius: 4px;
    }
    .news-number {
      color: #999;
      font-size: 13px;
      font-weight: 600;
      min-width: 20px;
      text-align: center;
      background: #f8f9fa;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .news-content {
      flex: 1;
      min-width: 0;
    }
    .news-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .source-name {
      color: #666;
      font-size: 12px;
      font-weight: 500;
    }
    .rank-num {
      color: #fff;
      background: #6b7280;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 10px;
    }
    .rank-num.top { background: #dc2626; }
    .rank-num.high { background: #ea580c; }
    .time-info {
      color: #999;
      font-size: 11px;
    }
    .news-title {
      font-size: 15px;
      line-height: 1.4;
      color: #1a1a1a;
      margin: 0;
    }
    .news-link {
      color: #2563eb;
      text-decoration: none;
    }
    .news-link:hover {
      text-decoration: underline;
    }
    .footer {
      margin-top: 32px;
      padding: 20px 24px;
      background: #f8f9fa;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      font-size: 13px;
      color: #6b7280;
    }
    .footer-link {
      color: #4f46e5;
      text-decoration: none;
    }
    @media (max-width: 480px) {
      body { padding: 12px; }
      .header { padding: 24px 20px; }
      .content { padding: 20px; }
      .header-info { gap: 12px; }
    }
    .header-manal{margin-top: 5px;}          
    .header-manal a{
        padding-left: 24px;
        text-decoration: none;
        color: #743beb;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-title">热点新闻 - ${reportModeText}</div>
      <div class="header-info">
        <div class="info-item">
          <span class="info-label">新闻总数</span>
          <span class="info-value">${totalNews} 条</span>
        </div>        
        <div class="info-item">
          <span class="info-label">生成时间</span>
          <span class="info-value">${generateTime}</span>
        </div>
      </div>
    </div>
    <div class="header-manal">
        <a href="/api/crawl?force=1">手动抓取</a>
        <a href="/api/push?force=1">手动推送</a>
        <a href="/api/token_logs">Token消耗</a>
    </div>
    <div class="content"> 
      ${content}
    </div>
    
    <div class="footer">
      由 <strong>TrendRadar</strong> 生成 · 
      <a href="https://github.com/sansan0/TrendRadar" target="_blank" class="footer-link">GitHub 开源项目</a>
      <br>
      Cloudflare Workers 版本 ${this.config.VERSION}
    </div>
  </div>
</body>
</html>`;
  }

  // HTML转义
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
  }
}
